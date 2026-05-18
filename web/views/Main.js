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
	isOperatorOrAdmin,
	isTrustedMarketplaceUrl,
	readBannerDismissed,
	readInstalledVersion,
	readMarketplaceField,
	readOperatorPath,
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
// Colours are explicit (fg/bg/border/dot) rather than opacity so the badge
// keeps its contrast on any host theme. State 0 is intentionally neutral —
// a brand-new user hasn't failed anything, so no alarming red.
const STATUS_LABELS = {
	0: { text: 'Not verified yet', fg: '#aab1c4', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)', dot: '#7c8499' },
	1: { text: 'Pending review', fg: '#fcd34d', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.28)', dot: '#fbbf24' },
	2: { text: 'Action needed', fg: '#fca5a5', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.28)', dot: '#f87171' },
	3: { text: 'Verified', fg: '#86efac', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.30)', dot: '#4ade80' },
};

// FaceVault hosted-page session states surfaced via the polling endpoint
// before HollaEx's id_data has been updated by the operator webhook.
const FV_STATE_LABELS = {
	in_progress: { text: 'Verification in progress', fg: '#fcd34d', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.28)', dot: '#fbbf24' },
	in_review: { text: 'Under review', fg: '#fcd34d', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.28)', dot: '#fbbf24' },
	passed: { text: 'Verified by FaceVault', fg: '#86efac', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.30)', dot: '#4ade80' },
	failed: { text: 'Verification failed', fg: '#fca5a5', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.28)', dot: '#f87171' },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const INK = '#eef0f6';
const MUTED = '#9aa1b2';
const FAINT = '#737a8c';

const STYLES = {
	// Outer wrapper just centres the card inside whatever the host tab gives
	// us. The card itself is theme-locked (owns its background + text colour
	// + font) so it looks identical on a light or dark HollaEx kit.
	root: {
		width: '100%', display: 'flex', justifyContent: 'center',
		padding: '20px', boxSizing: 'border-box', fontFamily: FONT,
	},
	card: {
		position: 'relative', width: '100%', maxWidth: '400px',
		padding: '34px 26px 26px', borderRadius: '20px',
		background: 'linear-gradient(180deg, #11131b 0%, #0c0d13 100%)',
		border: '1px solid rgba(255,255,255,0.08)',
		boxShadow: '0 20px 50px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
		color: INK, textAlign: 'center',
	},
	hero: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
	logo: {
		position: 'relative', width: '62px', height: '62px', borderRadius: '18px',
		display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '18px',
		background: 'radial-gradient(120% 120% at 30% 20%, rgba(74,222,128,0.22), rgba(34,211,238,0.10) 60%, rgba(255,255,255,0.02))',
		border: '1px solid rgba(74,222,128,0.22)',
		boxShadow: '0 0 0 1px rgba(74,222,128,0.20), 0 8px 28px rgba(34,211,238,0.18)',
	},
	title: {
		fontSize: '22px', fontWeight: '700', letterSpacing: '-0.01em',
		color: '#f6f7fb', margin: '0 0 7px',
	},
	subtitle: {
		fontSize: '13.5px', fontWeight: '500', color: MUTED,
		lineHeight: '1.55', margin: '0 auto 20px', maxWidth: '300px',
	},
	badge: {
		display: 'inline-flex', alignItems: 'center', gap: '7px',
		padding: '6px 13px', borderRadius: '999px',
		fontSize: '12.5px', fontWeight: '600', marginBottom: '22px',
		border: '1px solid transparent',
	},
	dot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
	steps: { width: '100%', margin: '2px 0 24px' },
	stepsTrack: {
		display: 'flex', alignItems: 'center', justifyContent: 'space-between',
		padding: '0 6px',
	},
	stepNum: {
		width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
		display: 'flex', alignItems: 'center', justifyContent: 'center',
		fontSize: '12px', fontWeight: '700', color: '#cdeede',
		background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.28)',
	},
	stepBar: {
		flex: '1 1 auto', height: '2px', borderRadius: '2px', margin: '0 8px',
		background: 'linear-gradient(90deg, rgba(74,222,128,0.35), rgba(34,211,238,0.35))',
	},
	stepsLabels: { display: 'flex', justifyContent: 'space-between', marginTop: '8px', padding: '0 1px' },
	stepLabel: { flex: 1, fontSize: '11px', fontWeight: '600', color: MUTED, whiteSpace: 'nowrap' },
	button: {
		display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px',
		width: '100%', padding: '15px 22px', boxSizing: 'border-box',
		border: 'none', borderRadius: '14px', fontFamily: 'inherit',
		background: 'linear-gradient(135deg, #4ade80, #22d3ee)',
		color: '#06150e', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
		boxShadow: '0 8px 24px rgba(34,211,238,0.28)',
		WebkitTapHighlightColor: 'transparent',
	},
	buttonDisabled: {
		background: 'rgba(255,255,255,0.07)', color: MUTED,
		boxShadow: 'none', cursor: 'not-allowed',
	},
	footer: {
		display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
		marginTop: '20px', fontSize: '11.5px', color: FAINT, lineHeight: '1.5',
	},
	verifiedWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 2px' },
	verifiedRing: {
		width: '64px', height: '64px', borderRadius: '50%', marginBottom: '12px',
		display: 'flex', alignItems: 'center', justifyContent: 'center',
		background: 'radial-gradient(circle at 50% 40%, rgba(74,222,128,0.24), rgba(74,222,128,0.05))',
		border: '1px solid rgba(74,222,128,0.35)',
	},
	verifiedTitle: { fontSize: '17px', fontWeight: '700', color: '#86efac', marginBottom: '3px' },
	verifiedSub: { fontSize: '12.5px', color: MUTED },
	note: {
		fontSize: '12.5px', color: '#bfe9d2', lineHeight: '1.5',
		background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.18)',
		borderRadius: '10px', padding: '11px 14px', marginTop: '14px',
		width: '100%', boxSizing: 'border-box',
	},
	noteError: {
		fontSize: '12.5px', color: '#fca5a5', lineHeight: '1.5',
		background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.20)',
		borderRadius: '10px', padding: '11px 14px', marginTop: '14px',
		width: '100%', boxSizing: 'border-box',
	},
	updateBanner: {
		position: 'relative', width: '100%', boxSizing: 'border-box',
		textAlign: 'left', padding: '13px 14px', marginBottom: '22px',
		background: 'linear-gradient(180deg, rgba(34,211,238,0.10), rgba(34,211,238,0.035))',
		border: '1px solid rgba(34,211,238,0.22)', borderRadius: '13px',
	},
	bannerTop: { display: 'flex', alignItems: 'flex-start', gap: '10px' },
	bannerIcon: { flexShrink: 0, marginTop: '1px', color: '#67e8f9' },
	bannerBody: { flex: 1, minWidth: 0, paddingRight: '14px' },
	bannerTitle: { fontSize: '12.5px', fontWeight: '700', color: '#a5f3fc', marginBottom: '2px' },
	bannerMeta: { fontSize: '11.5px', color: MUTED, marginBottom: '9px' },
	bannerUrl: {
		display: 'block', fontFamily: MONO, fontSize: '11px', color: '#cfeff5',
		background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.08)',
		borderRadius: '7px', padding: '7px 9px', marginBottom: '10px',
		wordBreak: 'break-all', WebkitUserSelect: 'all', userSelect: 'all',
	},
	bannerActions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
	bannerCta: {
		appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
		display: 'inline-flex', alignItems: 'center', gap: '6px',
		padding: '7px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700',
		background: 'rgba(34,211,238,0.18)', color: '#a5f3fc',
		border: '1px solid rgba(34,211,238,0.30)',
	},
	bannerCtaDisabled: { opacity: 0.6, cursor: 'wait' },
	bannerLink: {
		fontSize: '12px', fontWeight: '600', color: MUTED,
		textDecoration: 'none', padding: '7px 9px', borderRadius: '8px',
	},
	bannerDismiss: {
		position: 'absolute', top: '8px', right: '9px',
		appearance: 'none', background: 'transparent', border: 'none',
		color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
		fontSize: '17px', lineHeight: '1', padding: '2px 5px',
	},
	bannerCopied: {
		display: 'flex', alignItems: 'flex-start', gap: '6px',
		marginTop: '10px', fontSize: '11px', fontWeight: '600',
		color: '#86efac', lineHeight: '1.45',
	},
};

// Hover / focus / press / motion can't be expressed via inline style props,
// so inject one scoped <style> once. Every selector is prefixed with
// `.fvkyc-root` and keyframes are `fvkyc-`-namespaced so nothing leaks into
// the host exchange page. Decorative motion is gated behind
// prefers-reduced-motion; the layout/colour all come from inline styles, so
// the component still looks correct if a strict host CSP blocks this tag.
const STYLE_ID = 'fvkyc-style';
const STYLE_SHEET = [
	'.fvkyc-root, .fvkyc-root *{box-sizing:border-box}',
	'.fvkyc-root ::selection{background:rgba(34,211,238,0.30)}',
	'.fvkyc-root .fvkyc-cta{transition:transform .15s ease,box-shadow .15s ease,filter .15s ease}',
	'.fvkyc-root .fvkyc-cta:hover{transform:translateY(-1px);box-shadow:0 12px 30px rgba(34,211,238,0.42);filter:brightness(1.03)}',
	'.fvkyc-root .fvkyc-cta:active{transform:translateY(0) scale(.99);box-shadow:0 6px 18px rgba(34,211,238,0.30)}',
	'.fvkyc-root .fvkyc-cta:focus-visible{outline:2px solid #22d3ee;outline-offset:3px}',
	'.fvkyc-root .fvkyc-link{transition:color .15s ease,background .15s ease}',
	'.fvkyc-root .fvkyc-link:hover{color:#fff;background:rgba(255,255,255,0.06)}',
	'.fvkyc-root .fvkyc-bcta{transition:background .15s ease,border-color .15s ease}',
	'.fvkyc-root .fvkyc-bcta:hover{background:rgba(34,211,238,0.26);border-color:rgba(34,211,238,0.45)}',
	'.fvkyc-root .fvkyc-bcta:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}',
	'.fvkyc-root .fvkyc-dismiss:hover{color:rgba(255,255,255,0.9)}',
	'@keyframes fvkyc-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
	'@keyframes fvkyc-glow{0%,100%{box-shadow:0 0 0 1px rgba(74,222,128,0.22),0 8px 26px rgba(34,211,238,0.16)}50%{box-shadow:0 0 0 1px rgba(34,211,238,0.40),0 10px 34px rgba(34,211,238,0.30)}}',
	'@keyframes fvkyc-draw{to{stroke-dashoffset:0}}',
	'@keyframes fvkyc-spin{to{transform:rotate(360deg)}}',
	'.fvkyc-root .fvkyc-spin{animation:fvkyc-spin .7s linear infinite}',
	'@media (prefers-reduced-motion: no-preference){',
	'.fvkyc-root .fvkyc-card{animation:fvkyc-rise .42s cubic-bezier(.16,.84,.44,1) both}',
	'.fvkyc-root .fvkyc-logo{animation:fvkyc-glow 4.5s ease-in-out infinite}',
	'.fvkyc-root .fvkyc-check path{stroke-dasharray:60;stroke-dashoffset:60;animation:fvkyc-draw .8s .12s cubic-bezier(.65,0,.35,1) forwards}',
	'}',
].join('');

function injectStyles() {
	try {
		if (typeof document === 'undefined' || !document.head) return;
		if (document.getElementById(STYLE_ID)) return;
		var el = document.createElement('style');
		el.id = STYLE_ID;
		el.textContent = STYLE_SHEET;
		document.head.appendChild(el);
	} catch (_) {
		// Strict host CSP blocked the <style>. Inline styles still render the
		// component correctly — only hover/motion polish is lost.
	}
}

// Brand shield, gradient-stroked. Decorative — aria-hidden. `idSuffix` keeps
// the <linearGradient> id unique if the component ever mounts twice.
function ShieldMark({ size, withCheck, idSuffix }) {
	const gid = 'fvkyc-grad' + (idSuffix || '');
	return (
		<svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
			stroke={'url(#' + gid + ')'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			<defs>
				<linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#4ade80" />
					<stop offset="1" stopColor="#22d3ee" />
				</linearGradient>
			</defs>
			<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			{withCheck && <path d="M9 12l2 2 4-4" />}
		</svg>
	);
}

const VERIFY_STEPS = [
	{ n: 1, label: 'Document' },
	{ n: 2, label: 'Face match' },
	{ n: 3, label: 'Liveness' },
];

const POLL_INTERVAL_MS = 3000;
// 30 min covers slow user flows (capture, retries, document-fraud wait) and
// users who close + reopen the HollaEx tab while verification is in flight.
const POLL_TIMEOUT_MS = 30 * 60 * 1000;
// Exponential backoff on consecutive poll errors so a transient API outage
// doesn't burn 600 requests/session. Doubles each failure up to the cap.
const POLL_ERROR_BACKOFF_CAP_MS = 30 * 1000;

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
		this._consecutiveErrors = 0;
		this._isMounted = false;
		this._pollToken = null;   // signed fv_poll token, once delivered via postMessage
		this._verifyPop = null;   // verify-popup handle, for e.source identity check
		this._msgHandler = null;  // bound message listener; removed one-shot / on unmount
		this._onVisibilityChange = this._onVisibilityChange.bind(this);
	}

	// Setting state on an unmounted component logs a React warning and
	// leaks the closure. Guard every async setState call against this.
	_safeSetState(update) {
		if (this._isMounted) this.setState(update);
	}

	componentDidMount() {
		this._isMounted = true;
		injectStyles();
		// Always start polling on mount: the session may have been launched in
		// a previous page load (user closed + reopened this tab) or from a
		// different device. Polling auto-stops on terminal state.
		const cfg = resolveConfig(this.props);
		if (cfg.slug && this._extId()) {
			this._startPolling();
		}
		// Upgrade-banner data fetch — gated on slug only, NOT on operator
		// status. HollaEx Cloud doesn't expose operator/admin context as a
		// boolean at mount (no user.is_admin; permissions land late), so
		// gating the fetch on it is what hid the banner from the very
		// operators who can act on it. The manifest is cheap (server-side
		// Redis-cached, one fetch per mount). The banner *render* is what's
		// restricted to operators — see isOperatorOrAdmin in render().
		if (cfg.slug) {
			this._fetchManifest();
		}
		if (typeof document !== 'undefined' && document.addEventListener) {
			document.addEventListener('visibilitychange', this._onVisibilityChange);
		}
	}

	componentWillUnmount() {
		this._isMounted = false;
		this._stopPolling();
		this._teardownPollTokenListener();
		if (typeof document !== 'undefined' && document.removeEventListener) {
			document.removeEventListener('visibilitychange', this._onVisibilityChange);
		}
	}

	_onVisibilityChange() {
		// Pause the poll when the tab is backgrounded; resume when it's
		// foregrounded and we haven't reached the session deadline yet.
		// Backgrounded tabs throttle setInterval anyway but this halves
		// the request budget for users who park us in another tab.
		if (typeof document === 'undefined') return;
		if (document.hidden) {
			if (this._pollTimer) {
				clearInterval(this._pollTimer);
				this._pollTimer = null;
			}
		} else if (!this._pollTimer && this._pollDeadline > Date.now()) {
			this._scheduleNextPoll(POLL_INTERVAL_MS);
		}
	}

	_fetchManifest = async () => {
		const cfg = resolveConfig(this.props);
		try {
			const res = await fetch(cfg.apiBase + MANIFEST_PATH, { method: 'GET' });
			if (!res.ok) return;
			const data = await res.json();
			if (!data || !data.latest_version) return;
			this._safeSetState({
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
		this._safeSetState({ bannerDismissed: true, updateCopied: false });
	};

	// HollaEx Cloud's "Manually upgrade" has no paste-JSON field — only
	// "upload a JSON" or "input url path" — so we copy the marketplace JSON
	// *URL* (the operator pastes it straight into the Input URL path field)
	// and open the plugin admin panel. The URL is also shown selectable in
	// the banner as a fallback if the embed blocks the clipboard API.
	//
	// isTrustedMarketplaceUrl gates this hard: a compromised manifest must
	// not be able to hand the operator's installer an attacker-hosted JSON.
	_handleUpgrade = async () => {
		const { manifest, upgradeInFlight } = this.state;
		if (upgradeInFlight) return;
		if (!manifest || !manifest.marketplace_json_url) return;
		const url = manifest.marketplace_json_url;
		if (!isTrustedMarketplaceUrl(url)) {
			// Untrusted origin — never copy it / hand it to the installer.
			// Fall back to the changelog so the admin can get assets from a
			// known source manually.
			window.open(manifest.changelog_url, '_blank', 'noopener,noreferrer');
			return;
		}
		this._safeSetState({ upgradeInFlight: true, updateCopied: false });
		try {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(url);
				this._safeSetState({ updateCopied: true });
			}
		} catch (_) {
			// Clipboard blocked inside the embed — the URL is rendered
			// selectable in the banner as the fallback. Proceed regardless.
		} finally {
			// Operator panel path. Defaults to /operator/; HollaEx Cloud
			// overrides via web_view[0].meta.operator_path (/admin/plugins).
			// sanitizeOperatorPath rejects anything that isn't a same-origin
			// absolute path so a hostile meta value can't redirect us off-site.
			const operatorPath = readOperatorPath(this.props);
			window.open(window.location.origin + operatorPath, '_blank', 'noopener,noreferrer');
			this._safeSetState({ upgradeInFlight: false });
		}
	};

	_extId() {
		const u = this.props.user || {};
		return (u.id != null) ? ('hollaex_' + u.id) : null;
	}

	_pollOnce = async () => {
		const cfg = resolveConfig(this.props);
		let url;
		if (this._pollToken) {
			// Signed-token path: bound to the unguessable session_id; the API
			// ignores slug/ext here. Used once the /done popup delivered it.
			url = cfg.apiBase + '/api/v1/external_users/status'
				+ '?token=' + encodeURIComponent(this._pollToken);
		} else {
			// Legacy path — unchanged, and the automatic fallback: it keeps
			// running from launch, so a popup that never delivers a token
			// (old API, blocked/closed popup) still resolves via the existing
			// (slug, external_user_id) poll for un-migrated tenants.
			if (!cfg.slug) return;
			const ext = this._extId();
			if (!ext) return;
			url = cfg.apiBase + '/api/v1/external_users/status'
				+ '?slug=' + encodeURIComponent(cfg.slug)
				+ '&external_user_id=' + encodeURIComponent(ext);
		}
		try {
			const res = await fetch(url, { method: 'GET' });
			if (!res.ok) {
				this._consecutiveErrors += 1;
				return;
			}
			const data = await res.json();
			this._consecutiveErrors = 0;
			if (data && data.status) {
				this._safeSetState({ fvStatus: data.status });
				if (data.status === 'passed' || data.status === 'failed' || data.status === 'in_review') {
					this._stopPolling();
				}
			}
		} catch (_) {
			// Network blip — keep polling, but back off on repeated errors.
			this._consecutiveErrors += 1;
		}
	};

	// Doubles the base interval per consecutive error, capped. After a
	// successful poll _consecutiveErrors resets to 0, restoring normal cadence.
	_nextPollDelay() {
		if (this._consecutiveErrors === 0) return POLL_INTERVAL_MS;
		const delay = POLL_INTERVAL_MS * Math.pow(2, this._consecutiveErrors);
		return Math.min(delay, POLL_ERROR_BACKOFF_CAP_MS);
	}

	_scheduleNextPoll = (delay) => {
		if (this._pollTimer) clearInterval(this._pollTimer);
		this._pollTimer = setTimeout(async () => {
			if (!this._isMounted) return;
			if (Date.now() > this._pollDeadline) { this._stopPolling(); return; }
			// Don't burn requests on a hidden tab; visibility handler will
			// reschedule when it comes back to the foreground.
			if (typeof document !== 'undefined' && document.hidden) {
				this._pollTimer = null;
				return;
			}
			await this._pollOnce();
			if (this._isMounted && this._pollTimer !== null) {
				this._scheduleNextPoll(this._nextPollDelay());
			}
		}, delay);
	};

	_startPolling = () => {
		this._stopPolling();
		this._pollDeadline = Date.now() + POLL_TIMEOUT_MS;
		this._consecutiveErrors = 0;
		// Fire once immediately, then schedule subsequent polls.
		this._pollOnce().then(() => {
			if (!this._isMounted) return;
			this._pollTimer = -1; // sentinel: poller is active, will be replaced by setTimeout id
			this._scheduleNextPoll(this._nextPollDelay());
		});
	};

	_stopPolling = () => {
		if (this._pollTimer) {
			clearTimeout(this._pollTimer);
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
	};

	_buildVerifyUrl(cfg) {
		const ext = this._extId();
		const refQs = ext ? ('?ref=' + encodeURIComponent(ext)) : '';
		return cfg.hostedBase + '/v/' + encodeURIComponent(cfg.slug) + refQs;
	}

	_launchVerify = (cfg) => {
		const url = this._buildVerifyUrl(cfg);
		// Open WITH an opener (named window, no noopener/noreferrer) so the
		// hosted /v/<slug>/done page can postMessage the signed poll token
		// back to us. The opened URL is our own trusted hostedBase origin
		// (tight default-src 'self' CSP, only our nonce'd script) — same
		// pattern as OAuth/Stripe popups. The upgrade/changelog window.opens
		// are unchanged and keep noopener,noreferrer.
		let expectedOrigin = null;
		try { expectedOrigin = new URL(cfg.hostedBase).origin; } catch (_) {}
		this._teardownPollTokenListener();          // tidy on repeat clicks
		const pop = window.open(url, 'fvkyc_verify', 'popup');
		this._verifyPop = pop;
		const handler = (e) => {
			try {
				if (!expectedOrigin || e.origin !== expectedOrigin) return;
				if (!pop || e.source !== pop) return;
				const d = e.data;
				if (!d || d.type !== 'fv_poll_token') return;
				if (typeof d.token !== 'string' || !d.token || d.token.length >= 1024) return;
				this._pollToken = d.token;
				this._teardownPollTokenListener();  // one-shot
			} catch (_) { /* never throw out of a message handler */ }
		};
		this._msgHandler = handler;
		if (typeof window !== 'undefined' && window.addEventListener) {
			window.addEventListener('message', handler);
		}
		this._safeSetState({ launched: true });
		this._startPolling();
	};

	_teardownPollTokenListener = () => {
		if (this._msgHandler && typeof window !== 'undefined' && window.removeEventListener) {
			window.removeEventListener('message', this._msgHandler);
		}
		this._msgHandler = null;
	};

	_renderBanner(installed) {
		const { manifest, updateCopied, upgradeInFlight } = this.state;
		return (
			<div style={STYLES.updateBanner}>
				<button type="button" className="fvkyc-dismiss" style={STYLES.bannerDismiss}
					onClick={this._dismissBanner} aria-label="Dismiss update banner">
					×
				</button>
				<div style={STYLES.bannerTop}>
					<svg aria-hidden="true" style={STYLES.bannerIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="17 8 12 3 7 8" />
						<line x1="12" y1="3" x2="12" y2="15" />
					</svg>
					<div style={STYLES.bannerBody}>
						<div style={STYLES.bannerTitle}>
							Plugin update available — v{manifest.latest_version}
						</div>
						<div style={STYLES.bannerMeta}>
							{installed ? `You're on v${installed}` : 'Your installation is on a pre-update version'}
						</div>
						{manifest.marketplace_json_url && (
							<code style={STYLES.bannerUrl}>{manifest.marketplace_json_url}</code>
						)}
						<div style={STYLES.bannerActions}>
							<button
								type="button"
								className="fvkyc-bcta"
								disabled={upgradeInFlight}
								aria-busy={upgradeInFlight || undefined}
								style={{
									...STYLES.bannerCta,
									...(upgradeInFlight ? STYLES.bannerCtaDisabled : {}),
								}}
								onClick={this._handleUpgrade}
							>
								{upgradeInFlight && (
									<svg className="fvkyc-spin" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
										<path d="M21 12a9 9 0 1 1-6.2-8.5" />
									</svg>
								)}
								{upgradeInFlight ? 'Copying…' : 'Copy update URL'}
							</button>
							<a href={manifest.changelog_url} target="_blank" rel="noopener noreferrer" className="fvkyc-link" style={STYLES.bannerLink}>
								What's new
							</a>
						</div>
						{updateCopied && (
							<div style={STYLES.bannerCopied}>
								<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
									<polyline points="20 6 9 17 4 12" />
								</svg>
								<span>URL copied — in HollaEx: Plugins → Manually upgrade → Input URL path → paste &amp; confirm.</span>
							</div>
						)}
					</div>
				</div>
			</div>
		);
	}

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

		// Banner conditions: operator/admin viewer, manifest fetched, installed
		// version strictly older than latest. Missing installed_version (pre-banner
		// installs) is treated as ancient so the first cohort sees the
		// banner and upgrades once.
		const installed = readInstalledVersion(this.props);
		const showUpdateBanner = !!(
			isOperatorOrAdmin(this.props)
			&& this.state.manifest
			&& this.state.manifest.latest_version
			&& !this.state.bannerDismissed
			&& compareSemver(this.state.manifest.latest_version, installed || '0.0.0') > 0
		);

		const ctaLabel = isRejected ? 'Retry Verification' : (launched ? 'Reopen Verification' : 'Verify My Identity');

		return (
			<div className="fvkyc-root" style={STYLES.root}>
				<div className="fvkyc-card" style={STYLES.card}>
					{showUpdateBanner && this._renderBanner(installed)}

					<div style={STYLES.hero}>
						<div className="fvkyc-logo" style={STYLES.logo}>
							<ShieldMark size={30} withCheck idSuffix="-hero" />
						</div>

						<div style={STYLES.title}>Identity Verification</div>
						<div style={STYLES.subtitle}>
							{isVerified
								? 'Your identity has been verified successfully.'
								: isPending
								? "We're processing your verification — this page updates automatically."
								: 'Confirm your identity to unlock full access to the exchange.'}
						</div>

						<div style={{ ...STYLES.badge, color: statusInfo.fg, background: statusInfo.bg, borderColor: statusInfo.border }}>
							<div style={{ ...STYLES.dot, background: statusInfo.dot }} />
							{statusInfo.text}
						</div>
					</div>

					{isVerified && (
						<div style={STYLES.verifiedWrap}>
							<div style={STYLES.verifiedRing}>
								<svg className="fvkyc-check" aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
									<path d="M20 6 9 17l-5-5" />
								</svg>
							</div>
							<div style={STYLES.verifiedTitle}>Identity verified</div>
							<div style={STYLES.verifiedSub}>Secured by FaceVault</div>
						</div>
					)}

					{isRejected && note && (
						<div style={STYLES.noteError}>{note}</div>
					)}

					{!isVerified && !isPending && (
						<div style={STYLES.steps}>
							<div style={STYLES.stepsTrack}>
								{VERIFY_STEPS.map((s, i) => (
									<React.Fragment key={s.n}>
										<div style={STYLES.stepNum}>{s.n}</div>
										{i < VERIFY_STEPS.length - 1 && <div style={STYLES.stepBar} />}
									</React.Fragment>
								))}
							</div>
							<div style={STYLES.stepsLabels}>
								{VERIFY_STEPS.map((s, i) => (
									<div key={s.n} style={{
										...STYLES.stepLabel,
										textAlign: i === 0 ? 'left' : i === VERIFY_STEPS.length - 1 ? 'right' : 'center',
									}}>
										{s.label}
									</div>
								))}
							</div>
						</div>
					)}

					{!isVerified && !slugMissing && !userMissing && (
						<button
							type="button"
							className={isPending ? undefined : 'fvkyc-cta'}
							disabled={isPending}
							aria-disabled={isPending || undefined}
							style={{
								...STYLES.button,
								...(isPending ? STYLES.buttonDisabled : {}),
							}}
							onClick={isPending ? undefined : () => this._launchVerify(cfg)}
						>
							{!isPending && <ShieldMark size={17} idSuffix="-cta" />}
							{ctaLabel}
						</button>
					)}

					{slugMissing && (
						<div style={STYLES.noteError}>
							Plugin not configured — an administrator needs to download a customized plugin from the FaceVault dashboard.
						</div>
					)}

					{userMissing && !slugMissing && (
						<div style={STYLES.noteError}>
							Sign in required. Please refresh and try again.
						</div>
					)}

					{launched && !isVerified && (
						<div style={STYLES.note}>
							Verification opened in a new tab. Finish the steps there — this page updates automatically.
						</div>
					)}

					<div style={STYLES.footer}>
						<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<rect x="3" y="11" width="18" height="11" rx="2" />
							<path d="M7 11V7a5 5 0 0 1 10 0v4" />
						</svg>
						AES-256 encrypted · processed on FaceVault's infrastructure
					</div>
				</div>
			</div>
		);
	}
}

// Error boundary so a render exception in the plugin can't break the host
// HollaEx page. The fallback keeps the branded card so it still looks
// intentional; operators can inspect the browser console for the original.
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
				<div className="fvkyc-root" style={STYLES.root}>
					<div style={STYLES.card}>
						<div style={STYLES.title}>Identity Verification</div>
						<div style={STYLES.noteError}>
							Identity verification is temporarily unavailable. Please refresh the page or try again later.
						</div>
					</div>
				</div>
			);
		}
		return <FaceVaultKYC {...this.props} />;
	}
}

export default FaceVaultKYCErrorBoundary;
