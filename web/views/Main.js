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
 *   user           — Current user (id, id_data, full_name, ...)
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

// Walk redux-mapped webViews to find OUR plugin's web_view[0].meta. This is
// the per-operator (dashboard-generated) JSON path: slug + origins are baked
// into the JSON at download time.
function findOwnMeta(props) {
	try {
		var wv = props && props.webViews;
		if (!wv) return null;
		// Fast path: matching id from props
		if (props.id && Array.isArray(wv[props.id])) {
			for (var i = 0; i < wv[props.id].length; i++) {
				var e = wv[props.id][i];
				if (e && e.name === 'facevault-kyc' && e.meta) return e.meta;
			}
		}
		// Fallback: scan all targets
		for (var k in wv) {
			if (!Object.prototype.hasOwnProperty.call(wv, k)) continue;
			var arr = wv[k] || [];
			for (var j = 0; j < arr.length; j++) {
				var ee = arr[j];
				if (ee && ee.name === 'facevault-kyc' && ee.meta) return ee.meta;
			}
		}
	} catch (_) {}
	return null;
}

// Marketplace-installed plugins use top-level public_meta with operator-
// configurable schema fields. HollaEx persists the configured value either
// flat (`public_meta.slug = "acme"`) or schema-shaped (`public_meta.slug =
// {type, value: "acme", ...}`) — we accept both. enabledPlugins arrives
// from store.app.enabledPlugins via SmartTarget's mapStateToProps.
function readMarketplaceField(props, fieldName) {
	try {
		var ep = props && props.enabledPlugins;
		if (!Array.isArray(ep)) return null;
		for (var i = 0; i < ep.length; i++) {
			var p = ep[i];
			if (!p || p.name !== 'facevault-kyc') continue;
			var sources = [p.public_meta, p.meta];
			for (var s = 0; s < sources.length; s++) {
				var src = sources[s];
				if (!src) continue;
				var raw = src[fieldName];
				if (raw == null) continue;
				if (typeof raw === 'string' && raw) return raw;
				if (typeof raw === 'object' && typeof raw.value === 'string' && raw.value) return raw.value;
			}
		}
	} catch (_) {}
	return null;
}

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
	// API origin: explicit from meta, else map known prod/staging hosts off
	// the bundle origin, else assume same-origin (self-hosted).
	var apiBase = meta.api_base || readMarketplaceField(props, 'api_base');
	if (!apiBase) {
		var o = _SCRIPT_INFO.origin;
		if (o === 'https://facevault.id') apiBase = 'https://api.facevault.id';
		else if (o === 'https://staging.facevault.id') apiBase = 'https://api-staging.facevault.id';
		else apiBase = o || 'https://api.facevault.id';
	}
	return { slug: slug, hostedBase: hostedBase, apiBase: apiBase };
}

const STATUS_LABELS = {
	0: { text: 'Not Verified', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
	1: { text: 'Pending Review', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
	2: { text: 'Rejected', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
	3: { text: 'Verified', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
};

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
	subtitle: { fontSize: '14px', opacity: 0.5, marginBottom: '28px', textAlign: 'center', lineHeight: '1.5' },
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
	},
	buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
	note: { fontSize: '12px', opacity: 0.4, marginTop: '20px', textAlign: 'center', lineHeight: '1.5' },
	features: {
		display: 'flex', gap: '12px', flexWrap: 'wrap',
		justifyContent: 'center', marginBottom: '28px',
	},
	chip: {
		display: 'inline-flex', alignItems: 'center', gap: '4px',
		padding: '4px 10px', borderRadius: '16px',
		background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
		fontSize: '11px', opacity: 0.5,
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
};

const POLL_INTERVAL_MS = 3000;
// 30 min covers slow user flows (capture, retries, document-fraud wait) and
// users who close + reopen the HollaEx tab while verification is in flight.
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

class FaceVaultKYC extends Component {
	constructor(props) {
		super(props);
		this.state = {
			launched: false,
			fvStatus: null,
			pollError: null,
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
	}

	componentWillUnmount() {
		this._stopPolling();
	}

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
				this.setState({ fvStatus: data.status, pollError: null });
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
		if (!cfg.slug) return cfg.hostedBase;
		const ext = this._extId();
		const refQs = ext ? ('?ref=' + encodeURIComponent(ext)) : '';
		return cfg.hostedBase + '/v/' + encodeURIComponent(cfg.slug) + refQs;
	}

	handleVerifyClick = () => {
		this.setState({ launched: true });
		this._startPolling();
	};

	render() {
		const { user } = this.props;
		const { launched, fvStatus } = this.state;
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

		return (
			<div style={STYLES.container}>
				<div style={STYLES.logo}>
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
						<div style={{ fontSize: '12px', opacity: 0.5 }}>Powered by FaceVault</div>
					</div>
				)}

				{isRejected && note && (
					<div style={{ ...STYLES.launchedNote, color: '#f87171', borderColor: 'rgba(248,113,113,0.15)', background: 'rgba(248,113,113,0.06)' }}>
						{note}
					</div>
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
					<a
						href={this._buildVerifyUrl(cfg)}
						target="_blank"
						rel="noopener noreferrer"
						style={{ ...STYLES.button, ...(isPending ? STYLES.buttonDisabled : {}) }}
						onClick={this.handleVerifyClick}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
						</svg>
						{isRejected ? 'Retry Verification' : (launched ? 'Reopen Verification' : 'Verify My Identity')}
					</a>
				)}

				{slugMissing && (
					<div style={{ ...STYLES.launchedNote, color: '#f87171', borderColor: 'rgba(248,113,113,0.15)', background: 'rgba(248,113,113,0.06)' }}>
						Plugin not configured — administrator needs to download a customized plugin from the FaceVault dashboard.
					</div>
				)}

				{userMissing && !slugMissing && (
					<div style={{ ...STYLES.launchedNote, color: '#f87171', borderColor: 'rgba(248,113,113,0.15)', background: 'rgba(248,113,113,0.06)' }}>
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
						? 'Your data is encrypted at rest and processed on-premises.'
						: 'Takes about 2 minutes. You\'ll need a valid ID and your camera.'}
				</div>
			</div>
		);
	}
}

export default FaceVaultKYC;
