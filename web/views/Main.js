/**
 * FaceVault KYC Plugin — Web View for HollaEx (v2 / hosted-page mode)
 *
 * Architecture: HollaEx Cloud blocks custom plugin server scripts (returns
 * 405 on /plugins/facevault/*). This webview avoids them entirely. Verify
 * button opens FaceVault's hosted page (/v/<slug>) in a new tab; status is
 * polled from a public FaceVault endpoint scoped to (slug, external_user_id).
 *
 * Per-operator config — slug + origins:
 * HollaEx kit's @paciolan/remote-component fetches the bundle via XHR and
 * evaluates it in a sandbox where document.currentScript is null, so we can
 * NOT read query params from the script src at runtime. The dashboard
 * generator instead injects slug / hosted_base / api_base into the plugin
 * JSON's web_view[0].meta. HollaEx pushes that into redux state, and
 * SmartTarget spreads `webViews` (and `id`) onto our component, so we
 * recover the values from props.webViews[props.id][i].meta at render time.
 *
 * The document.currentScript path is kept as a fallback for self-hosted
 * setups that inject the bundle via a real <script> tag.
 *
 * Props from HollaEx kit:
 *   user           — Current user (id, id_data, full_name, is_admin, ...)
 *   webViews       — Object keyed by target id; each value is the array of
 *                    plugin web_view entries (with their meta) for that target
 *   id             — Current target id (e.g. 'verification:facevault-kyc:home')
 *   strings        — Localization strings
 *   activeLanguage — Current language code
 */

const _SCRIPT_INFO = (function () {
	try {
		var s = document.currentScript;
		if (!s || !s.src) return { slug: null, origin: null };
		var u = new URL(s.src);
		return { slug: u.searchParams.get('slug') || null, origin: u.origin };
	} catch (_) {
		return { slug: null, origin: null };
	}
})();

import React, { Component } from 'react';
import {
	compareSemver,
	findOwnMeta,
	isAdminUser,
	isTrustedMarketplaceUrl,
	readBannerDismissed,
	readInstalledVersion,
	readMarketplaceField,
	writeBannerDismissed,
} from './utils';

// Resolves slug + origins from props (primary) or document.currentScript.src
// (fallback for self-hosted with <script> tag injection).
// Sentinel slug shipped in the generic template. Both XHR-eval and
// <script>-tag paths can pick it up; treat it as "no slug" so the bundle
// renders the friendly "Plugin not configured" hint instead of opening
// /v/configure-via-dashboard (which 404s).
var _PLACEHOLDER_SLUG = 'configure-via-dashboard';

function resolveConfig(props) {
	var meta = findOwnMeta(props) || {};
	// Resolution order:
	// 1. web_view[0].meta.slug — dashboard-generated per-operator JSON
	// 2. enabledPlugins[].public_meta.slug — marketplace install + Configure
	// 3. document.currentScript.src — self-hosted with <script> tag injection
	var slug = meta.slug
		|| readMarketplaceField(props, 'slug')
		|| _SCRIPT_INFO.slug
		|| null;
	if (slug === _PLACEHOLDER_SLUG) slug = null;
	var hostedBase = meta.hosted_base
		|| readMarketplaceField(props, 'hosted_base')
		|| _SCRIPT_INFO.origin
		|| 'https://facevault.id';
	// API origin: explicit from meta (dashboard-generated JSONs always set
	// this); fall back to the bundle's own origin for self-hosted setups;
	// last resort the public prod API.
	var apiBase = meta.api_base
		|| readMarketplaceField(props, 'api_base')
		|| _SCRIPT_INFO.origin
		|| 'https://api.facevault.id';
	if (apiBase === 'https://facevault.id') apiBase = 'https://api.facevault.id';
	return { slug: slug, hostedBase: hostedBase, apiBase: apiBase };
}

// HollaEx's user.id_data.status uses 0=not verified, 1=pending review,
// 2=rejected, 3=verified. We mirror that mapping for the in-tab badge.
const STATUS_LABELS = {
	0: { text: 'Not Verified', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
	1: { text: 'Pending Review', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
	2: { text: 'Rejected', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
	3: { text: 'Verified', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
};

// FaceVault hosted-page session states surfaced via the polling endpoint
// before HollaEx's id_data has been updated by the operator webhook.
const FV_STATE_LABELS = {
	in_progress: { text: 'Verification in progress', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
	in_review: { text: 'Under review', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
	passed: { text: 'Verified by FaceVault', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
	failed: { text: 'Verification failed', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
};

const STYLES = {
	container: {
		display: 'flex', flexDirection: 'column', alignItems: 'center',
		padding: '32px 24px', maxWidth: '420px', margin: '0 auto',
	},
	logo: {
		width: '56px', height: '56px', borderRadius: '16px',
		background: 'linear-gradient(135deg, rgba(74,222,128,0.12), rgba(34,211,238,0.08))',
		display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px',
	},
	title: { fontSize: '20px', fontWeight: '700', marginBottom: '8px', textAlign: 'center' },
	subtitle: { fontSize: '14px', opacity: 0.6, marginBottom: '28px', textAlign: 'center', lineHeight: '1.5' },
	badge: {
		display: 'inline-flex', alignItems: 'center', gap: '6px',
		padding: '6px 14px', borderRadius: '20px',
		fontSize: '13px', fontWeight: '600', marginBottom: '24px',
	},
	dot: { width: '8px', height: '8px', borderRadius: '50%' },
	button: {
		display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
		width: '100%', padding: '14px 24px', boxSizing: 'border-box',
		border: 'none', borderRadius: '12px',
		background: 'linear-gradient(135deg, #4ade80, #22d3ee)',
		color: '#0c0c12', fontSize: '15px', fontWeight: '700',
		cursor: 'pointer', textDecoration: 'none', textAlign: 'center',
		transition: 'opacity 0.2s',
		// Keep keyboard nav visible — overrides browser default suppression
		// on linear-gradient backgrounds.
		outlineOffset: '2px',
	},
	buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
	note: { fontSize: '12px', opacity: 0.6, marginTop: '20px', textAlign: 'center', lineHeight: '1.5' },
	features: {
		display: 'flex', gap: '12px', flexWrap: 'wrap',
		justifyContent: 'center', marginBottom: '28px',
	},
	chip: {
		display: 'inline-flex', alignItems: 'center', gap: '4px',
		padding: '4px 10px', borderRadius: '16px',
		background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
		fontSize: '11px', opacity: 0.6,
	},
	verifiedCard: {
		width: '100%', padding: '16px 20px', borderRadius: '12px',
		background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.12)',
		textAlign: 'center',
	},
	launchedNote: {
		fontSize: '13px', color: 'rgba(255,255,255,0.7)',
		background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)',
		borderRadius: '8px', padding: '12px 14px', marginTop: '16px',
		textAlign: 'center', width: '100%', boxSizing: 'border-box',
	},
	launchedNoteError: {
		fontSize: '13px', color: '#f87171',
		background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)',
		borderRadius: '8px', padding: '12px 14px', marginTop: '16px',
		textAlign: 'center', width: '100%', boxSizing: 'border-box',
	},
	updateBanner: {
		width: '100%', boxSizing: 'border-box',
		display: 'flex', alignItems: 'flex-start', gap: '12px',
		padding: '12px 14px', marginBottom: '20px',
		background: 'rgba(34,211,238,0.06)',
		border: '1px solid rgba(34,211,238,0.18)',
		borderRadius: '10px',
	},
	updateBannerIcon: {
		flexShrink: 0, marginTop: '2px', color: '#22d3ee',
	},
	updateBannerBody: { flex: 1, minWidth: 0 },
	updateBannerTitle: {
		fontSize: '13px', fontWeight: '600', color: '#22d3ee', marginBottom: '2px',
	},
	updateBannerMeta: {
		fontSize: '12px', opacity: 0.7, marginBottom: '8px',
	},
	updateBannerActions: {
		display: 'flex', gap: '8px', flexWrap: 'wrap',
	},
	updateBannerCta: {
		appearance: 'none', cursor: 'pointer',
		padding: '6px 12px', borderRadius: '6px',
		fontSize: '12px', fontWeight: '600',
		background: 'rgba(34,211,238,0.15)',
		color: '#22d3ee',
		border: '1px solid rgba(34,211,238,0.25)',
	},
	updateBannerCtaDisabled: { opacity: 0.5, cursor: 'wait' },
	updateBannerLink: {
		display: 'inline-flex', alignItems: 'center',
		padding: '6px 10px', borderRadius: '6px',
		fontSize: '12px', fontWeight: '500',
		color: 'rgba(255,255,255,0.7)',
		textDecoration: 'none', background: 'transparent',
	},
	updateBannerDismiss: {
		appearance: 'none', background: 'transparent', border: 'none',
		color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
		fontSize: '18px', lineHeight: '1', padding: '0 4px',
	},
	updateBannerCopied: {
		marginTop: '8px', fontSize: '11px', color: '#4ade80',
	},
};

const POLL_INTERVAL_MS = 3000;
// 30 min covers slow user flows (capture, retries, document-fraud wait) and
// users who close + reopen the HollaEx tab while verification is in flight.
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

// Plugin update detection. Manifest is fetched from FaceVault on mount and
// compared to the installed_version baked into web_view[0].meta. Admin users
// on stale versions see an upgrade banner above the verify button.
const MANIFEST_PATH = '/api/v1/integrations/hollaex/manifest';

class FaceVaultKYC extends Component {
	constructor(props) {
		super(props);
		this.state = {
			launched: false,
			fvStatus: null,
			manifest: null,
			bannerDismissed: false,
			updateCopied: false,
			upgradeInFlight: false,
		};
		this._pollTimer = null;
		this._pollDeadline = 0;
	}

	componentDidMount() {
		// Always start polling on mount: the session may have been launched in
		// a previous page load (user closed + reopened this tab) or from a
		// different device. Polling auto-stops on terminal state.
		const cfg = resolveConfig(this.props);
		if (cfg.slug && this._extId()) {
			this._startPolling();
		}
		// Upgrade-banner fetch — only matters for admin users on a
		// configured plugin. No point hitting the manifest endpoint
		// otherwise (would just count against our cache budget).
		if (cfg.slug && isAdminUser(this.props)) {
			this._fetchManifest();
		}
	}

	componentWillUnmount() {
		this._stopPolling();
	}

	_fetchManifest = async () => {
		const cfg = resolveConfig(this.props);
		try {
			const res = await fetch(cfg.apiBase + MANIFEST_PATH, { method: 'GET' });
			if (!res.ok) return;
			const data = await res.json();
			if (!data || !data.latest_version) return;
			this.setState({
				manifest: data,
				bannerDismissed: readBannerDismissed(data.latest_version),
			});
		} catch (_) {
			// CORS/CSP block or transient network failure — banner just
			// doesn't show. Plugin keeps working normally.
		}
	};

	_dismissBanner = () => {
		const { manifest } = this.state;
		if (manifest && manifest.latest_version) {
			writeBannerDismissed(manifest.latest_version);
		}
		this.setState({ bannerDismissed: true, updateCopied: false });
	};

	// Fetch the latest plugin JSON, copy to clipboard, open operator panel.
	// We can't actually install the plugin for them — HollaEx doesn't expose
	// a webview-side admin API for that — but we can compress the upgrade
	// down to "click banner, switch tabs, paste, save."
	//
	// The marketplace_json_url is checked against a trusted-origin allowlist
	// before fetch: if the manifest endpoint is ever compromised, we must
	// not write attacker-controlled content to the operator's clipboard.
	_handleUpgrade = async () => {
		const { manifest, upgradeInFlight } = this.state;
		if (upgradeInFlight) return;
		if (!manifest || !manifest.marketplace_json_url) return;
		if (!isTrustedMarketplaceUrl(manifest.marketplace_json_url)) {
			// Refuse to fetch from an untrusted origin. Fall back to the
			// changelog page so the admin can grab assets from a known
			// source manually.
			window.open(manifest.changelog_url, '_blank', 'noopener,noreferrer');
			return;
		}
		this.setState({ upgradeInFlight: true, updateCopied: false });
		try {
			const res = await fetch(manifest.marketplace_json_url);
			if (!res.ok) throw new Error('fetch failed');
			const jsonText = await res.text();
			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(jsonText);
				this.setState({ updateCopied: true });
			}
			// HollaEx kits commonly serve the operator panel at /operator/
			// on the same origin the user is currently on. Some kit variants
			// route admin differently; on those, this opens a 404 in a new
			// tab and the admin navigates manually from the home page.
			window.open(window.location.origin + '/operator/', '_blank', 'noopener,noreferrer');
		} catch (_) {
			// On failure, at least open the changelog so they can grab the
			// JSON manually from the GH release page.
			window.open(manifest.changelog_url, '_blank', 'noopener,noreferrer');
		} finally {
			this.setState({ upgradeInFlight: false });
		}
	};

	_extId() {
		const u = this.props.user || {};
		return (u.id != null) ? ('hollaex_' + u.id) : null;
	}

	_pollOnce = async () => {
		const cfg = resolveConfig(this.props);
		if (!cfg.slug) return;
		const ext = this._extId();
		if (!ext) return;
		try {
			const url = cfg.apiBase + '/api/v1/external_users/status'
				+ '?slug=' + encodeURIComponent(cfg.slug)
				+ '&external_user_id=' + encodeURIComponent(ext);
			const res = await fetch(url, { method: 'GET' });
			if (!res.ok) return;
			const data = await res.json();
			if (data && data.status) {
				this.setState({ fvStatus: data.status });
				if (data.status === 'passed' || data.status === 'failed' || data.status === 'in_review') {
					this._stopPolling();
				}
			}
		} catch (_) {
			// Network blip — keep polling, surface only persistent errors
		}
	};

	_startPolling = () => {
		this._stopPolling();
		this._pollDeadline = Date.now() + POLL_TIMEOUT_MS;
		this._pollOnce();
		this._pollTimer = setInterval(() => {
			if (Date.now() > this._pollDeadline) { this._stopPolling(); return; }
			this._pollOnce();
		}, POLL_INTERVAL_MS);
	};

	_stopPolling = () => {
		if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
	};

	_buildVerifyUrl(cfg) {
		const ext = this._extId();
		const refQs = ext ? ('?ref=' + encodeURIComponent(ext)) : '';
		return cfg.hostedBase + '/v/' + encodeURIComponent(cfg.slug) + refQs;
	}

	_launchVerify = (cfg) => {
		const url = this._buildVerifyUrl(cfg);
		window.open(url, '_blank', 'noopener,noreferrer');
		this.setState({ launched: true });
		this._startPolling();
	};

	render() {
		const { user } = this.props;
		const { launched, fvStatus, manifest, bannerDismissed, updateCopied, upgradeInFlight } = this.state;
		const cfg = resolveConfig(this.props);
		const idData = (user && user.id_data) || {};
		const hxStatus = idData.status || 0;

		const showFvBadge = !!fvStatus && (fvStatus === 'passed' || fvStatus === 'failed' || fvStatus === 'in_review');
		const isVerified = hxStatus === 3 || fvStatus === 'passed';
		const isPending = hxStatus === 1;
		const isRejected = hxStatus === 2;
		const note = (idData.note || '').replace(/ \[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]$/, '') || null;

		const slugMissing = !cfg.slug;
		const userMissing = !this._extId();

		const hxStatusInfo = STATUS_LABELS[hxStatus] || STATUS_LABELS[0];
		const fvStatusInfo = fvStatus ? FV_STATE_LABELS[fvStatus] : null;
		const statusInfo = showFvBadge ? fvStatusInfo : hxStatusInfo;

		// Banner conditions: admin user, manifest fetched, installed version
		// strictly older than latest. Missing installed_version (pre-banner
		// installs) is treated as ancient so the first cohort sees the
		// banner and upgrades once.
		const installed = readInstalledVersion(this.props);
		const showUpdateBanner = !!(
			isAdminUser(this.props)
			&& manifest
			&& manifest.latest_version
			&& !bannerDismissed
			&& compareSemver(manifest.latest_version, installed || '0.0.0') > 0
		);

		const ctaLabel = isRejected ? 'Retry Verification' : (launched ? 'Reopen Verification' : 'Verify My Identity');

		return (
			<div style={STYLES.container}>
				{showUpdateBanner && (
					<div style={STYLES.updateBanner}>
						<svg aria-hidden="true" style={STYLES.updateBannerIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						<div style={STYLES.updateBannerBody}>
							<div style={STYLES.updateBannerTitle}>
								Plugin update available — v{manifest.latest_version}
							</div>
							<div style={STYLES.updateBannerMeta}>
								{installed ? `You're on v${installed}` : 'Your installation is on a pre-update version'}
							</div>
							<div style={STYLES.updateBannerActions}>
								<button
									type="button"
									disabled={upgradeInFlight}
									aria-busy={upgradeInFlight || undefined}
									style={{
										...STYLES.updateBannerCta,
										...(upgradeInFlight ? STYLES.updateBannerCtaDisabled : {}),
									}}
									onClick={this._handleUpgrade}
								>
									{upgradeInFlight ? 'Working…' : 'Update now'}
								</button>
								<a href={manifest.changelog_url} target="_blank" rel="noopener noreferrer" style={STYLES.updateBannerLink}>
									What's new
								</a>
							</div>
							{updateCopied && (
								<div style={STYLES.updateBannerCopied}>
									New plugin JSON copied — paste in HollaEx Operator → Plugins.
								</div>
							)}
						</div>
						<button type="button" style={STYLES.updateBannerDismiss} onClick={this._dismissBanner} aria-label="Dismiss update banner">
							×
						</button>
					</div>
				)}

				<div style={STYLES.logo}>
					<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
						<path d="M9 12l2 2 4-4" />
					</svg>
				</div>

				<div style={STYLES.title}>Identity Verification</div>
				<div style={STYLES.subtitle}>
					{isVerified
						? 'Your identity has been verified successfully.'
						: isPending
						? 'Your verification is being processed.'
						: 'Verify your identity to unlock full exchange access.'}
				</div>

				<div style={{ ...STYLES.badge, color: statusInfo.color, background: statusInfo.bg }}>
					<div style={{ ...STYLES.dot, background: statusInfo.color }} />
					{statusInfo.text}
				</div>

				{isVerified && (
					<div style={STYLES.verifiedCard}>
						<div style={{ fontSize: '14px', fontWeight: '600', color: '#4ade80', marginBottom: '4px' }}>
							Verification Complete
						</div>
						<div style={{ fontSize: '12px', opacity: 0.6 }}>Powered by FaceVault</div>
					</div>
				)}

				{isRejected && note && (
					<div style={STYLES.launchedNoteError}>{note}</div>
				)}

				{!isVerified && !isPending && (
					<div style={STYLES.features}>
						<span style={STYLES.chip}>ID Document</span>
						<span style={STYLES.chip}>Face Match</span>
						<span style={STYLES.chip}>Liveness Check</span>
						<span style={STYLES.chip}>Anti-Spoofing</span>
					</div>
				)}

				{!isVerified && !slugMissing && !userMissing && (
					<button
						type="button"
						disabled={isPending}
						aria-disabled={isPending || undefined}
						style={{
							...STYLES.button,
							...(isPending ? STYLES.buttonDisabled : {}),
						}}
						onClick={isPending ? undefined : () => this._launchVerify(cfg)}
					>
						<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
						</svg>
						{ctaLabel}
					</button>
				)}

				{slugMissing && (
					<div style={STYLES.launchedNoteError}>
						Plugin not configured — administrator needs to download a customized plugin from the FaceVault dashboard.
					</div>
				)}

				{userMissing && !slugMissing && (
					<div style={STYLES.launchedNoteError}>
						Sign in required. Please refresh and try again.
					</div>
				)}

				{launched && !isVerified && (
					<div style={STYLES.launchedNote}>
						Verification opened in a new tab. Complete the steps there — this page will update automatically.
					</div>
				)}

				<div style={STYLES.note}>
					{isVerified
						? 'Your data is encrypted at rest and processed on FaceVault\'s secure infrastructure.'
						: 'Takes about 2 minutes. You\'ll need a valid ID and your camera.'}
				</div>
			</div>
		);
	}
}

// Error boundary so a render exception in the plugin can't break the host
// HollaEx page. The fallback is intentionally minimal — operators can
// inspect the browser console for the original error.
class FaceVaultKYCErrorBoundary extends Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error: error };
	}

	componentDidCatch(error, info) {
		if (typeof console !== 'undefined' && console.error) {
			console.error('[facevault-kyc] webview error:', error, info);
		}
	}

	render() {
		if (this.state.error) {
			return (
				<div style={STYLES.container}>
					<div style={STYLES.title}>Identity Verification</div>
					<div style={STYLES.launchedNoteError}>
						Identity verification is temporarily unavailable. Please refresh the page or try again later.
					</div>
				</div>
			);
		}
		return <FaceVaultKYC {...this.props} />;
	}
}

export default FaceVaultKYCErrorBoundary;
