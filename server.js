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
 *
 * Auth: HollaEx populates req.auth on authenticated plugin routes.
 * Webhook HMAC: FaceVault signs with JSON.dumps(payload, separators=(",",":"),
 *   sort_keys=True) — compact, recursively sorted keys, no whitespace.
 *   Signature is hex-encoded SHA256 in the X-Signature header.
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ─── Helpers ────────────────────────────────────────────

function facevaultRequest(method, path, body) {
	const apiKey = meta.api_key.value;
	// String concat to preserve baseUrl path (new URL() would drop it)
	const baseUrl = meta.api_url.value.replace(/\/+$/, '');
	const fullUrl = baseUrl + path;

	return new Promise((resolve, reject) => {
		const url = new URL(fullUrl);
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
		// Timeout destroys the socket; the promise rejects and the route
		// handler's try/catch returns 500 to the caller.
		req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });

		if (body) req.write(JSON.stringify(body));
		req.end();
	});
}

/**
 * Recursively sort object keys to match Python's json.dumps(sort_keys=True).
 * Returns a new object with all keys sorted at every nesting level.
 */
function sortKeys(obj) {
	if (obj === null || typeof obj !== 'object') return obj;
	if (Array.isArray(obj)) return obj.map(sortKeys);
	const sorted = {};
	Object.keys(obj).sort().forEach((k) => { sorted[k] = sortKeys(obj[k]); });
	return sorted;
}

/**
 * Verify HMAC-SHA256 signature.
 * FaceVault signs with compact JSON (no whitespace, recursively sorted keys).
 * Signature is hex-encoded.
 */
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

		const idData = (user.id_data || {});

		// Don't allow re-verification if already verified
		if (idData.status === 3) {
			return res.status(400).json({ message: 'Already verified' });
		}

		// Block if already pending — prevents spamming FaceVault sessions.
		// Allow retry after 10 minutes to unstick users whose session expired
		// or who closed the browser before completing verification.
		if (idData.status === 1) {
			const note = idData.note || '';
			const tsMatch = note.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]$/);
			if (tsMatch) {
				const age = Date.now() - new Date(tsMatch[1]).getTime();
				if (age < 600000) {
					return res.status(409).json({ message: 'Verification already in progress' });
				}
			}
			// No timestamp = assume stale (e.g. admin-set pending), allow retry
		}

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

		// Only mark as pending AFTER successful session creation.
		// Timestamp in note enables stale-session detection (10 min TTL).
		await toolsLib.user.updateUserInfo(user.id, {
			id_data: { status: 1, note: 'FaceVault verification in progress [' + new Date().toISOString() + ']' }
		});

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
//
// HMAC verification: FaceVault signs with compact, recursively sorted JSON
// (Python's json.dumps(separators=(",",":"), sort_keys=True)). We reproduce
// this by recursively sorting keys and using JSON.stringify with no whitespace.
//
// Note: HollaEx's plugin runtime pre-parses req.body. We re-serialize to
// match the signed format. This is tested against FaceVault's actual signing.

app.post('/plugins/facevault/webhook', async (req, res) => {
	try {
		const signature = req.headers['x-signature'] || req.headers['x-facevault-signature'];
		const webhookSecret = meta.webhook_secret.value;

		// Re-serialize to match FaceVault's signing format:
		// compact JSON, recursively sorted keys, no whitespace
		const rawBody = typeof req.body === 'string'
			? req.body
			: JSON.stringify(sortKeys(req.body));
		if (!verifyHmac(webhookSecret, rawBody, signature)) {
			loggerPlugin.warn('FaceVault webhook: invalid signature');
			return res.status(401).json({ message: 'Invalid signature' });
		}

		const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

		// Only handle verification.completed events
		if (event.event !== 'verification.completed') {
			return res.status(200).json({ message: 'Ignored' });
		}

		// Replay protection: reject if signed_at is missing or older than 5 minutes
		if (!event.signed_at) {
			loggerPlugin.warn('FaceVault webhook: missing signed_at');
			return res.status(401).json({ message: 'Missing signed_at' });
		}
		const age = Date.now() - new Date(event.signed_at).getTime();
		if (age > 300000 || age < -60000) {
			loggerPlugin.warn('FaceVault webhook: stale or future signature (age=%dms)', age);
			return res.status(401).json({ message: 'Stale webhook' });
		}

		// Extract HollaEx user ID from external_user_id
		const externalId = event.external_user_id || '';
		const match = externalId.match(/^hollaex_(\d+)$/);
		if (!match) {
			loggerPlugin.warn('FaceVault webhook: unrecognized external_user_id:', externalId);
			return res.status(200).json({ message: 'Not a HollaEx session' });
		}

		// HollaEx kit uses numeric user IDs
		const userId = parseInt(match[1], 10);
		const status = event.status;
		const trustScore = event.trust_score;
		const trustDecision = event.trust_decision;
		const confirmedData = event.confirmed_data || {};

		loggerPlugin.info(
			'FaceVault webhook: user=%d status=%s trust=%s score=%d face_match=%s',
			userId, status, trustDecision, trustScore, event.face_match_passed
		);

		if (status === 'passed' && trustDecision === 'accept') {
			// Verification passed — upgrade user level and store name in one update
			const targetLevel = (meta.verified_level && meta.verified_level.value) || 2;
			await toolsLib.user.changeUserVerificationLevelById(userId, targetLevel);

			const update = {
				id_data: {
					status: 3,
					note: 'Verified via FaceVault (trust score: ' + trustScore + ')'
				}
			};
			if (confirmedData.full_name) {
				update.full_name = confirmedData.full_name;
			}
			await toolsLib.user.updateUserInfo(userId, update);
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
// Note: reads from req.auth (token-time state). A user who just completed
// verification via webhook will see stale data until their next token refresh.

app.get('/plugins/facevault/status', (req, res) => {
	const user = req.auth;
	if (!user || !user.id) {
		return res.status(401).json({ message: 'Authentication required' });
	}

	const idData = user.id_data || {};
	const statusMap = { 0: 'unverified', 1: 'pending', 2: 'rejected', 3: 'verified' };

	// Strip internal timestamp from note before returning to frontend
	const rawNote = idData.note || null;
	const cleanNote = rawNote ? rawNote.replace(/ \[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]$/, '') : null;

	res.json({
		status: idData.status || 0,
		label: statusMap[idData.status] || 'unverified',
		note: cleanNote,
		verified: idData.status === 3,
	});
});
