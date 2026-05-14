/**
 * Pure helper functions used by Main.js — extracted so they're trivially
 * testable in isolation (no React, no DOM, no fetch). Keeping the React
 * component free of business logic lets us catch regressions in the parts
 * that have historically broken (kit-state mapping, version compare,
 * banner gating) without spinning up a full render harness.
 */

// Lexicographic semver comparison for X.Y.Z releases. Returns positive if
// a > b, negative if a < b, 0 if equal. Defensive against missing or
// non-numeric inputs (treats them as 0).
export function compareSemver(a, b) {
	const parse = (v) => {
		const parts = String(v || '0.0.0').split('.');
		return [
			parseInt(parts[0], 10) || 0,
			parseInt(parts[1], 10) || 0,
			parseInt(parts[2], 10) || 0,
		];
	};
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return pa[i] - pb[i];
	}
	return 0;
}

export function isAdminUser(props) {
	const u = props && props.user;
	return !!(u && u.is_admin === true);
}

// Walk redux-mapped webViews to find our plugin's web_view[0].meta. Used
// for both per-operator dashboard JSON (slug + origins baked in) and the
// installed_version baked at build time.
export function findOwnMeta(props) {
	try {
		const wv = props && props.webViews;
		if (!wv) return null;
		// Fast path: matching id from props
		if (props.id && Array.isArray(wv[props.id])) {
			for (let i = 0; i < wv[props.id].length; i++) {
				const e = wv[props.id][i];
				if (e && e.name === 'facevault-kyc' && e.meta) return e.meta;
			}
		}
		// Fallback: scan all targets
		for (const k in wv) {
			if (!Object.prototype.hasOwnProperty.call(wv, k)) continue;
			const arr = wv[k] || [];
			for (let j = 0; j < arr.length; j++) {
				const ee = arr[j];
				if (ee && ee.name === 'facevault-kyc' && ee.meta) return ee.meta;
			}
		}
	} catch (_) {}
	return null;
}

// Marketplace-installed plugins use top-level public_meta with operator-
// configurable schema fields. HollaEx persists the configured value either
// flat (`public_meta.slug = "acme"`) or schema-shaped (`public_meta.slug =
// { type, value: "acme", ... }`); we accept both. Different kit versions
// expose plugin configs in either props.plugins or props.enabledPlugins,
// so we walk both.
export function readMarketplaceField(props, fieldName) {
	try {
		const lists = [];
		if (props && Array.isArray(props.plugins)) lists.push(props.plugins);
		if (props && Array.isArray(props.enabledPlugins)) lists.push(props.enabledPlugins);
		for (let l = 0; l < lists.length; l++) {
			const arr = lists[l];
			for (let i = 0; i < arr.length; i++) {
				const p = arr[i];
				if (!p || typeof p !== 'object' || p.name !== 'facevault-kyc') continue;
				const sources = [p.public_meta, p.meta];
				for (let s = 0; s < sources.length; s++) {
					const src = sources[s];
					if (!src) continue;
					const raw = src[fieldName];
					if (raw == null) continue;
					if (typeof raw === 'string' && raw) return raw;
					if (typeof raw === 'object' && typeof raw.value === 'string' && raw.value) return raw.value;
				}
			}
		}
	} catch (_) {}
	return null;
}

export function readInstalledVersion(props) {
	const meta = findOwnMeta(props) || {};
	return meta.installed_version || null;
}

// Session-scoped banner dismissal. Key includes the latest version so a
// fresh release immediately re-prompts an operator who dismissed the
// previous version's banner.
export function bannerDismissKey(latestVersion) {
	return 'fv_hx_banner_dismissed_' + (latestVersion || 'unknown');
}

export function readBannerDismissed(latestVersion, storage) {
	const s = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
	if (!s) return false;
	try {
		return s.getItem(bannerDismissKey(latestVersion)) === '1';
	} catch (_) {
		return false;
	}
}

export function writeBannerDismissed(latestVersion, storage) {
	const s = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
	if (!s) return;
	try {
		s.setItem(bannerDismissKey(latestVersion), '1');
	} catch (_) {}
}

// Origin allowlist for the upgrade-now JSON fetch. The manifest endpoint
// is FaceVault-owned, but if it's ever compromised — or if a redirect
// sneaks into the API surface — we must not write attacker-controlled
// content to the operator's clipboard. Hard-restrict to known origins.
export const TRUSTED_MARKETPLACE_ORIGINS = Object.freeze([
	'https://github.com',
	'https://facevault.id',
]);

export function isTrustedMarketplaceUrl(url) {
	if (typeof url !== 'string' || !url) return false;
	try {
		const u = new URL(url);
		return TRUSTED_MARKETPLACE_ORIGINS.indexOf(u.origin) !== -1;
	} catch (_) {
		return false;
	}
}

// HollaEx operator panel path. Defaults to `/operator/` which is the
// stock kit route; operators on a custom admin path can override by
// setting web_view[0].meta.operator_path before installing. We only
// accept same-origin absolute paths (starts with `/`) — anything else
// gets ignored so a hostile meta value can't redirect the admin off-site.
export const DEFAULT_OPERATOR_PATH = '/operator/';

export function sanitizeOperatorPath(raw) {
	if (typeof raw !== 'string' || !raw) return DEFAULT_OPERATOR_PATH;
	// Must be an absolute same-origin path. Reject schemes, protocol-
	// relative URLs, and anything that could re-target the open() call.
	if (raw[0] !== '/' || raw.indexOf('//') === 0) return DEFAULT_OPERATOR_PATH;
	return raw;
}

export function readOperatorPath(props) {
	const meta = findOwnMeta(props) || {};
	return sanitizeOperatorPath(meta.operator_path);
}
