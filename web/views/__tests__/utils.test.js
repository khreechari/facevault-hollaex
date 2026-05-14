/**
 * Tests for the pure helpers extracted from Main.js.
 *
 * Coverage targets the parts of the plugin that have historically broken:
 *  - kit-state mapping (props.plugins vs props.enabledPlugins)
 *  - meta resolution (per-operator dashboard JSON vs marketplace install)
 *  - version compare (banner gating)
 *  - origin allowlist (clipboard supply-chain defense)
 */

const {
	compareSemver,
	findOwnMeta,
	isAdminUser,
	isTrustedMarketplaceUrl,
	readBannerDismissed,
	readInstalledVersion,
	readMarketplaceField,
	writeBannerDismissed,
	bannerDismissKey,
	TRUSTED_MARKETPLACE_ORIGINS,
} = require('../utils');

describe('compareSemver', () => {
	test('higher major wins', () => {
		expect(compareSemver('3.0.0', '2.99.99')).toBeGreaterThan(0);
	});
	test('higher minor wins when major equal', () => {
		expect(compareSemver('2.1.0', '2.0.99')).toBeGreaterThan(0);
	});
	test('higher patch wins when major+minor equal', () => {
		expect(compareSemver('2.0.4', '2.0.3')).toBeGreaterThan(0);
	});
	test('equal versions return 0', () => {
		expect(compareSemver('2.0.4', '2.0.4')).toBe(0);
	});
	test('lower version returns negative', () => {
		expect(compareSemver('2.0.3', '2.0.4')).toBeLessThan(0);
	});
	test('treats missing as 0.0.0', () => {
		expect(compareSemver(null, '0.0.1')).toBeLessThan(0);
		expect(compareSemver(undefined, '0.0.0')).toBe(0);
		expect(compareSemver('', '0.0.0')).toBe(0);
	});
	test('treats non-numeric parts as 0', () => {
		expect(compareSemver('2.x.0', '2.0.0')).toBe(0);
		expect(compareSemver('garbage', '0.0.0')).toBe(0);
	});
	test('short versions parse correctly', () => {
		expect(compareSemver('2', '1.9.9')).toBeGreaterThan(0);
		expect(compareSemver('2.0', '2.0.0')).toBe(0);
	});
});

describe('isAdminUser', () => {
	test('true when user.is_admin === true', () => {
		expect(isAdminUser({ user: { is_admin: true } })).toBe(true);
	});
	test('false for any non-true value (no truthy-coercion)', () => {
		expect(isAdminUser({ user: { is_admin: false } })).toBe(false);
		expect(isAdminUser({ user: { is_admin: 1 } })).toBe(false);
		expect(isAdminUser({ user: { is_admin: 'true' } })).toBe(false);
		expect(isAdminUser({ user: { is_admin: undefined } })).toBe(false);
	});
	test('false when user missing', () => {
		expect(isAdminUser({})).toBe(false);
		expect(isAdminUser(null)).toBe(false);
		expect(isAdminUser(undefined)).toBe(false);
	});
});

describe('findOwnMeta', () => {
	const meta = { slug: 'acme', installed_version: '2.0.4' };

	test('fast path: finds meta by matching id', () => {
		const props = {
			id: 'verification:facevault-kyc:home',
			webViews: {
				'verification:facevault-kyc:home': [
					{ name: 'facevault-kyc', meta: meta },
				],
			},
		};
		expect(findOwnMeta(props)).toBe(meta);
	});

	test('fallback: scans all targets when id miss', () => {
		const props = {
			id: 'wrong-id',
			webViews: {
				'other-target': [
					{ name: 'other-plugin', meta: { foo: 'bar' } },
					{ name: 'facevault-kyc', meta: meta },
				],
			},
		};
		expect(findOwnMeta(props)).toBe(meta);
	});

	test('returns null when plugin not present', () => {
		const props = {
			webViews: { 't1': [{ name: 'other', meta: { x: 1 } }] },
		};
		expect(findOwnMeta(props)).toBeNull();
	});

	test('returns null on malformed props (defensive)', () => {
		expect(findOwnMeta(null)).toBeNull();
		expect(findOwnMeta({})).toBeNull();
		expect(findOwnMeta({ webViews: null })).toBeNull();
		expect(findOwnMeta({ webViews: 'not an object' })).toBeNull();
	});
});

describe('readMarketplaceField', () => {
	test('walks props.plugins (modern kit shape)', () => {
		const props = {
			plugins: [
				{ name: 'other', public_meta: { slug: 'wrong' } },
				{ name: 'facevault-kyc', public_meta: { slug: 'acme' } },
			],
		};
		expect(readMarketplaceField(props, 'slug')).toBe('acme');
	});

	test('walks props.enabledPlugins (older kit shape)', () => {
		const props = {
			enabledPlugins: [
				{ name: 'facevault-kyc', public_meta: { slug: 'acme' } },
			],
		};
		expect(readMarketplaceField(props, 'slug')).toBe('acme');
	});

	test('accepts schema-shaped value ({type, value})', () => {
		const props = {
			plugins: [
				{ name: 'facevault-kyc', public_meta: { slug: { type: 'string', value: 'acme' } } },
			],
		};
		expect(readMarketplaceField(props, 'slug')).toBe('acme');
	});

	test('skips empty string and empty schema value', () => {
		const props = {
			plugins: [
				{ name: 'facevault-kyc', public_meta: { slug: '' } },
				{ name: 'facevault-kyc', public_meta: { slug: { type: 'string', value: '' } } },
			],
		};
		expect(readMarketplaceField(props, 'slug')).toBeNull();
	});

	test('falls back to meta if public_meta is missing the field', () => {
		const props = {
			plugins: [
				{ name: 'facevault-kyc', meta: { slug: 'meta-fallback' } },
			],
		};
		expect(readMarketplaceField(props, 'slug')).toBe('meta-fallback');
	});

	test('returns null on malformed inputs', () => {
		expect(readMarketplaceField(null, 'slug')).toBeNull();
		expect(readMarketplaceField({}, 'slug')).toBeNull();
		expect(readMarketplaceField({ plugins: 'not array' }, 'slug')).toBeNull();
	});
});

describe('readInstalledVersion', () => {
	test('reads from web_view[0].meta.installed_version', () => {
		const props = {
			id: 't',
			webViews: { t: [{ name: 'facevault-kyc', meta: { installed_version: '2.0.4' } }] },
		};
		expect(readInstalledVersion(props)).toBe('2.0.4');
	});
	test('returns null when missing', () => {
		expect(readInstalledVersion({})).toBeNull();
		expect(readInstalledVersion({
			id: 't',
			webViews: { t: [{ name: 'facevault-kyc', meta: {} }] },
		})).toBeNull();
	});
});

describe('isTrustedMarketplaceUrl', () => {
	test('accepts github.com release URLs', () => {
		expect(isTrustedMarketplaceUrl(
			'https://github.com/khreechari/facevault-hollaex/releases/download/v2.0.5/facevault-kyc.marketplace.json'
		)).toBe(true);
	});
	test('accepts facevault.id URLs', () => {
		expect(isTrustedMarketplaceUrl(
			'https://facevault.id/facevault-kyc.marketplace.json'
		)).toBe(true);
	});
	test('rejects look-alike host', () => {
		expect(isTrustedMarketplaceUrl(
			'https://github.com.evil.com/khreechari/facevault-hollaex/'
		)).toBe(false);
	});
	test('rejects http:// (must be https)', () => {
		expect(isTrustedMarketplaceUrl(
			'http://github.com/foo'
		)).toBe(false);
	});
	test('rejects other origins', () => {
		expect(isTrustedMarketplaceUrl('https://attacker.example/x.json')).toBe(false);
	});
	test('rejects malformed input', () => {
		expect(isTrustedMarketplaceUrl(null)).toBe(false);
		expect(isTrustedMarketplaceUrl('')).toBe(false);
		expect(isTrustedMarketplaceUrl('not a url')).toBe(false);
	});
	test('allowlist is frozen', () => {
		expect(Object.isFrozen(TRUSTED_MARKETPLACE_ORIGINS)).toBe(true);
	});
});

describe('banner dismissal storage', () => {
	// In-memory storage stub — keeps tests decoupled from jsdom's
	// sessionStorage, which not all jest setups provide.
	const makeStorage = () => {
		const data = {};
		return {
			getItem: (k) => (k in data ? data[k] : null),
			setItem: (k, v) => { data[k] = String(v); },
		};
	};

	test('writes a version-scoped key', () => {
		const s = makeStorage();
		writeBannerDismissed('2.0.5', s);
		expect(s.getItem(bannerDismissKey('2.0.5'))).toBe('1');
	});

	test('readBannerDismissed roundtrips write', () => {
		const s = makeStorage();
		expect(readBannerDismissed('2.0.5', s)).toBe(false);
		writeBannerDismissed('2.0.5', s);
		expect(readBannerDismissed('2.0.5', s)).toBe(true);
	});

	test('dismissal does not bleed across versions', () => {
		const s = makeStorage();
		writeBannerDismissed('2.0.5', s);
		expect(readBannerDismissed('2.0.6', s)).toBe(false);
	});

	test('survives a throwing storage (defensive)', () => {
		const s = {
			getItem: () => { throw new Error('quota'); },
			setItem: () => { throw new Error('quota'); },
		};
		expect(() => writeBannerDismissed('2.0.5', s)).not.toThrow();
		expect(readBannerDismissed('2.0.5', s)).toBe(false);
	});
});
