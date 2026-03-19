/**
 * FaceVault KYC Plugin — Server Script for HollaEx
 *
 * Routes:
 *   POST /plugins/facevault/session   — Start a new verification session
 *   POST /plugins/facevault/webhook   — Receive verification result callback
 *   GET  /plugins/facevault/status    — Check current user's verification status
 *
 * Available globals (provided by HollaEx plugin runtime):
 *   app          — Express router
 *   meta         — Private plugin config (api_key, api_url, webhook_secret, ...)
 *   publicMeta   — Public plugin config (app_url)
 *   toolsLib     — HollaEx user/admin utility library
 *   loggerPlugin — Plugin logger
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ─── Helpers ────────────────────────────────────────────

function facevaultRequest(method, path, body) {
	const apiKey = meta.api_key.value;
	const baseUrl = meta.api_url.value.replace(/\/+$/, '');

	return new Promise((resolve, reject) => {
		const url = new URL(path, baseUrl);
		const mod = url.protocol === 'https:' ? https : http;

		const options = {
			method,
			hostname: url.hostname,
			port: url.port || (url.protocol === 'https:' ? 443 : 80),
			path: url.pathname + url.search,
			headers: {
				'Authorization': 'Bearer ' + apiKey,
				'Content-Type': 'application/json',
				'User-Agent': 'HollaEx-FaceVault-Plugin/1.0',
			},
		};

		const req = mod.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				try {
					resolve({ status: res.statusCode, data: JSON.parse(data) });
				} catch (_) {
					resolve({ status: res.statusCode, data: data });
				}
			});
		});

		req.on('error', reject);
		req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });

		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}

function verifyHmac(secret, payload, signature) {
	if (!secret || !signature) return false;
	const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
	try {
		return crypto.timingSafeEqual(
			Buffer.from(expected, 'hex'),
			Buffer.from(signature, 'hex')
		);
	} catch (_) {
		return false;
	}
}

// ─── POST /plugins/facevault/session ────────────────────
// Creates a FaceVault verification session for the authenticated user.
// Returns the verification URL that the frontend opens in a new tab.

app.post('/plugins/facevault/session', async (req, res) => {
	try {
		const user = req.auth;
		if (!user || !user.id) {
			return res.status(401).json({ message: 'Authentication required' });
		}

		// Don't allow re-verification if already verified
		const idData = (user.id_data || {});
		if (idData.status === 3) {
			return res.status(400).json({ message: 'Already verified' });
		}

		// Mark as pending
		await toolsLib.user.updateUserInfo(user.id, {
			id_data: { status: 1, note: 'FaceVault verification in progress' }
		});

		// Build query params
		const externalId = 'hollaex_' + user.id;
		let qs = '?external_user_id=' + encodeURIComponent(externalId);
		if (meta.require_poa && meta.require_poa.value) {
			qs += '&require_poa=true';
		}

		// Create session via FaceVault API
		const result = await facevaultRequest('POST', '/api/v1/sessions' + qs);

		if (result.status !== 200 && result.status !== 201) {
			loggerPlugin.error('FaceVault session creation failed:', result.data);
			return res.status(502).json({ message: 'Failed to create verification session' });
		}

		const sessionData = result.data;
		const sessionToken = sessionData.session_token;
		const appUrl = (publicMeta.app_url && publicMeta.app_url.value) || 'https://app.facevault.id';
		const verificationUrl = appUrl + '?token=' + sessionToken;

		res.json({
			url: verificationUrl,
			session_id: sessionData.session_id,
		});
	} catch (err) {
		loggerPlugin.error('FaceVault session error:', err.message);
		res.status(500).json({ message: 'Internal error creating verification session' });
	}
});

// ─── POST /plugins/facevault/webhook ────────────────────
// Receives HMAC-signed webhook from FaceVault when verification completes.
// Updates the HollaEx user's verification level based on the result.

app.post('/plugins/facevault/webhook', async (req, res) => {
	try {
		const signature = req.headers['x-signature'] || req.headers['x-facevault-signature'];
		const webhookSecret = meta.webhook_secret.value;

		// Verify HMAC signature
		const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
		if (!verifyHmac(webhookSecret, rawBody, signature)) {
			loggerPlugin.warn('FaceVault webhook: invalid signature');
			return res.status(401).json({ message: 'Invalid signature' });
		}

		const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

		// Only handle verification.completed events
		if (event.event !== 'verification.completed') {
			return res.status(200).json({ message: 'Ignored' });
		}

		// Extract HollaEx user ID from external_user_id
		const externalId = event.external_user_id || '';
		const match = externalId.match(/^hollaex_(\d+)$/);
		if (!match) {
			loggerPlugin.warn('FaceVault webhook: unrecognized external_user_id:', externalId);
			return res.status(200).json({ message: 'Not a HollaEx session' });
		}

		const userId = parseInt(match[1], 10);
		const status = event.status;
		const trustScore = event.trust_score;
		const trustDecision = event.trust_decision;
		const faceMatch = event.face_match_passed;
		const confirmedData = event.confirmed_data || {};

		loggerPlugin.info(
			'FaceVault webhook: user=%d status=%s trust=%s score=%d',
			userId, status, trustDecision, trustScore
		);

		if (status === 'passed' && trustDecision === 'accept') {
			// Verification passed — upgrade user level
			const targetLevel = (meta.verified_level && meta.verified_level.value) || 2;
			await toolsLib.user.changeUserVerificationLevelById(userId, targetLevel);
			await toolsLib.user.updateUserInfo(userId, {
				id_data: {
					status: 3,
					note: 'Verified via FaceVault (trust score: ' + trustScore + ')'
				}
			});

			// Store confirmed name if available
			if (confirmedData.full_name) {
				await toolsLib.user.updateUserInfo(userId, {
					full_name: confirmedData.full_name
				});
			}
		} else if (status === 'failed') {
			// Verification failed
			await toolsLib.user.updateUserInfo(userId, {
				id_data: {
					status: 2,
					note: 'Verification failed (trust score: ' + trustScore + ')'
				}
			});
		} else {
			// Under review
			await toolsLib.user.updateUserInfo(userId, {
				id_data: {
					status: 1,
					note: 'Under manual review (trust score: ' + trustScore + ')'
				}
			});
		}

		res.json({ message: 'OK' });
	} catch (err) {
		loggerPlugin.error('FaceVault webhook error:', err.message);
		res.status(500).json({ message: 'Webhook processing failed' });
	}
});

// ─── GET /plugins/facevault/status ──────────────────────
// Returns the current user's verification status.

app.get('/plugins/facevault/status', (req, res) => {
	const user = req.auth;
	if (!user || !user.id) {
		return res.status(401).json({ message: 'Authentication required' });
	}

	const idData = user.id_data || {};
	const statusMap = { 0: 'unverified', 1: 'pending', 2: 'rejected', 3: 'verified' };

	res.json({
		status: idData.status || 0,
		label: statusMap[idData.status] || 'unverified',
		note: idData.note || null,
		verified: idData.status === 3,
	});
});
