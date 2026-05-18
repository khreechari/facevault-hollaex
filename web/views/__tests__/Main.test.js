/**
 * @jest-environment jsdom
 *
 * Render tests for the FaceVaultKYC webview component + error boundary.
 *
 * The pure helpers are covered exhaustively in utils.test.js. What's
 * exercised here is the part that has historically broken in production
 * but had no automated guard: the banner-gating boolean logic in render()
 * and the _handleUpgrade clipboard / operator-panel flow. Every bug in the
 * HollaEx Cloud upgrade-path saga (admin gate, version pin, CORS fetch,
 * operator_path) surfaced in exactly this code path.
 */

require('@testing-library/jest-dom');
const React = require('react');
const { render, screen, fireEvent, waitFor, cleanup, act } = require('@testing-library/react');

const FaceVaultKYC = require('../Main').default;
const { __resetVerifyChannelForTests } = require('../Main');

// Builds the props HollaEx pushes into the webview: web_view[0].meta lives
// under webViews[id][i] keyed by plugin name (see findOwnMeta).
function makeProps({ user, meta }) {
	return {
		id: 'verification:facevault-kyc:home',
		webViews: {
			'verification:facevault-kyc:home': [
				{ name: 'facevault-kyc', meta: meta },
			],
		},
		user: user,
	};
}

const BASE_META = {
	slug: 'acme',
	api_base: 'https://api.facevault.id',
	installed_version: '2.0.10',
	operator_path: '/admin/plugins',
};

const OPERATOR = { permissions: ['/admin/kit:get', '/admin/users:get'] };
const TRADING_USER = { id: 7, id_data: {} };

// Route fetch by URL substring. Unmatched requests resolve to a benign
// not-ok response so a stray poll never rejects a test.
function mockFetch(routes) {
	return jest.fn((url) => {
		for (let i = 0; i < routes.length; i++) {
			const r = routes[i];
			if (String(url).indexOf(r.match) !== -1) {
				return Promise.resolve({
					ok: r.ok !== false,
					json: async () => r.json,
					text: async () => r.text,
				});
			}
		}
		return Promise.resolve({ ok: false, json: async () => ({}), text: async () => '' });
	});
}

const MANIFEST = '/integrations/hollaex/manifest';

beforeEach(() => {
	// The verify→token channel is module-scoped (survives a HollaEx remount
	// in prod); reset it so each render starts from a clean world.
	__resetVerifyChannelForTests();
	window.sessionStorage.clear();
	window.open = jest.fn();
	Object.defineProperty(window.navigator, 'clipboard', {
		value: { writeText: jest.fn().mockResolvedValue(undefined) },
		configurable: true,
	});
	global.fetch = jest.fn(() =>
		Promise.resolve({ ok: false, json: async () => ({}), text: async () => '' })
	);
});

afterEach(cleanup);
afterEach(() => { jest.useRealTimers(); });

describe('upgrade banner gating', () => {
	test('does not render for a plain trading user even when an update exists', async () => {
		global.fetch = mockFetch([
			{ match: MANIFEST, json: { latest_version: '2.0.11' } },
		]);
		render(React.createElement(FaceVaultKYC, makeProps({ user: TRADING_USER, meta: BASE_META })));

		// Title always renders; wait for the manifest fetch to resolve so
		// we're asserting the render gate, not a timing gap.
		await screen.findByText('Identity Verification');
		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining(MANIFEST),
				expect.anything()
			)
		);
		await waitFor(() => {});

		expect(screen.queryByText(/Plugin update available/i)).not.toBeInTheDocument();
	});

	test('renders for an operator when latest_version > installed_version', async () => {
		global.fetch = mockFetch([
			{ match: MANIFEST, json: { latest_version: '2.0.11' } },
		]);
		render(React.createElement(FaceVaultKYC, makeProps({ user: OPERATOR, meta: BASE_META })));

		expect(await screen.findByText(/Plugin update available — v2\.0\.11/)).toBeInTheDocument();
		expect(screen.getByText("You're on v2.0.10")).toBeInTheDocument();
	});

	test('does not render for an operator when latest_version == installed_version', async () => {
		global.fetch = mockFetch([
			{ match: MANIFEST, json: { latest_version: '2.0.10' } },
		]);
		render(React.createElement(FaceVaultKYC, makeProps({ user: OPERATOR, meta: BASE_META })));

		await screen.findByText('Identity Verification');
		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining(MANIFEST),
				expect.anything()
			)
		);
		await waitFor(() => {});

		expect(screen.queryByText(/Plugin update available/i)).not.toBeInTheDocument();
	});

	test('dismiss button hides the banner and records a version-scoped flag', async () => {
		global.fetch = mockFetch([
			{ match: MANIFEST, json: { latest_version: '2.0.11' } },
		]);
		render(React.createElement(FaceVaultKYC, makeProps({ user: OPERATOR, meta: BASE_META })));

		await screen.findByText(/Plugin update available — v2\.0\.11/);
		fireEvent.click(screen.getByRole('button', { name: /Dismiss update banner/i }));

		expect(screen.queryByText(/Plugin update available/i)).not.toBeInTheDocument();
		expect(window.sessionStorage.getItem('fv_hx_banner_dismissed_2.0.11')).toBe('1');
	});
});

describe('verify CTA', () => {
	test('is disabled and inert while HollaEx review is pending', async () => {
		global.fetch = mockFetch([
			{ match: MANIFEST, ok: false },
			{ match: '/external_users/status', json: { status: 'in_progress' } },
		]);
		const user = { id: 42, id_data: { status: 1 } };
		render(React.createElement(FaceVaultKYC, makeProps({ user: user, meta: BASE_META })));

		const btn = screen.getByRole('button', { name: /Verify My Identity/i });
		expect(btn).toBeDisabled();

		fireEvent.click(btn);
		expect(window.open).not.toHaveBeenCalled();

		// Let the mount-time poll resolve so its setState lands inside act.
		await waitFor(() => expect(global.fetch).toHaveBeenCalled());
	});
});

describe('error boundary', () => {
	test('renders the fallback when the inner component throws on render', () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		try {
			// idData.note is read unconditionally as a string (`.replace`);
			// a non-string truthy value makes render() throw.
			const user = { id_data: { note: 12345 } };
			render(React.createElement(FaceVaultKYC, makeProps({ user: user, meta: BASE_META })));

			expect(
				screen.getByText(/Identity verification is temporarily unavailable/i)
			).toBeInTheDocument();
			expect(screen.queryByText(/Verify My Identity/i)).not.toBeInTheDocument();
			expect(consoleError).toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});

describe('_handleUpgrade clipboard + operator-panel flow', () => {
	test('refuses an untrusted marketplace_json_url and falls back to the changelog', async () => {
		const CHANGELOG = 'https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.11';
		global.fetch = mockFetch([
			{
				match: MANIFEST,
				json: {
					latest_version: '2.0.11',
					marketplace_json_url: 'https://attacker.example/evil.json',
					changelog_url: CHANGELOG,
				},
			},
		]);
		render(React.createElement(FaceVaultKYC, makeProps({ user: OPERATOR, meta: BASE_META })));

		await screen.findByText(/Plugin update available/);
		fireEvent.click(screen.getByRole('button', { name: /Copy update URL/i }));

		await waitFor(() =>
			expect(window.open).toHaveBeenCalledWith(CHANGELOG, '_blank', 'noopener,noreferrer')
		);
		expect(window.navigator.clipboard.writeText).not.toHaveBeenCalled();
		// The untrusted origin must never be fetched.
		const fetchedUntrusted = global.fetch.mock.calls.some(
			(c) => String(c[0]).indexOf('attacker.example') !== -1
		);
		expect(fetchedUntrusted).toBe(false);
	});

	test('trusted URL: copies the install URL (not the JSON) and opens /admin/plugins', async () => {
		const MKT_URL = 'https://facevault.id/plugins/facevault-kyc.marketplace.json';
		global.fetch = mockFetch([
			{
				match: MANIFEST,
				json: {
					latest_version: '2.0.12',
					marketplace_json_url: MKT_URL,
					changelog_url: 'https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.12',
				},
			},
		]);
		render(React.createElement(FaceVaultKYC, makeProps({ user: OPERATOR, meta: BASE_META })));

		await screen.findByText(/Plugin update available/);
		// The URL is shown selectable in the banner (clipboard-blocked fallback).
		expect(screen.getByText(MKT_URL)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /Copy update URL/i }));

		// Copies the URL itself — NOT a fetched JSON body.
		await waitFor(() =>
			expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(MKT_URL)
		);
		// jsdom origin is http://localhost; operator_path comes from meta.
		expect(window.open).toHaveBeenCalledWith(
			'http://localhost/admin/plugins',
			'_blank',
			'noopener,noreferrer'
		);
		// The marketplace JSON must no longer be fetched (only the manifest).
		const fetchedMkt = global.fetch.mock.calls.some(
			(c) => String(c[0]).indexOf('/facevault-kyc.marketplace.json') !== -1
		);
		expect(fetchedMkt).toBe(false);
		expect(await screen.findByText(/URL copied/i)).toBeInTheDocument();
	});
});

describe('signed-poll token (postMessage from /done)', () => {
	test('verify popup is opened WITH an opener — no noopener/noreferrer', async () => {
		global.fetch = mockFetch([
			{ match: MANIFEST, ok: false },
			{ match: '/external_users/status', json: { status: 'in_progress' } },
		]);
		const user = { id: 42, id_data: {} }; // status 0 → CTA enabled
		render(React.createElement(FaceVaultKYC, makeProps({ user: user, meta: BASE_META })));

		const btn = await screen.findByRole('button', { name: /Verify My Identity/i });
		fireEvent.click(btn);

		// Named window, no noopener/noreferrer (so window.opener is set and the
		// /v/<slug>/done page can postMessage the token back).
		expect(window.open).toHaveBeenCalledWith(
			expect.stringContaining('/v/acme'),
			'fvkyc_verify',
			'popup'
		);
		// The upgrade/changelog opens are untouched — still noopener,noreferrer
		// (covered by the _handleUpgrade suite above).
		await waitFor(() => expect(global.fetch).toHaveBeenCalled());
	});

	test('hostile postMessages are ignored and never throw', async () => {
		global.fetch = mockFetch([
			{ match: MANIFEST, ok: false },
			{ match: '/external_users/status', json: { status: 'in_progress' } },
		]);
		const fakePop = { name: 'fvkyc_verify' };
		window.open = jest.fn(() => fakePop);
		const user = { id: 42, id_data: {} };
		render(React.createElement(FaceVaultKYC, makeProps({ user: user, meta: BASE_META })));

		fireEvent.click(await screen.findByRole('button', { name: /Verify My Identity/i }));

		// hostedBase resolves to https://facevault.id in jsdom (no hosted_base
		// in BASE_META, no currentScript). Each of these must fail a gate and
		// be silently ignored — and crucially never throw out of the handler.
		const fire = (init) => window.dispatchEvent(new MessageEvent('message', init));
		expect(() => {
			fire({ data: { type: 'fv_poll_token', token: 'tok' }, origin: 'https://evil.example', source: fakePop }); // wrong origin
			fire({ data: { type: 'fv_poll_token', token: 'tok' }, origin: 'https://facevault.id', source: {} });       // wrong source
			fire({ data: { type: 'nope' }, origin: 'https://facevault.id', source: fakePop });                          // wrong type
			fire({ data: { type: 'fv_poll_token', token: 'A'.repeat(2000) }, origin: 'https://facevault.id', source: fakePop }); // oversized
			fire({ data: null, origin: 'https://facevault.id', source: fakePop });                                      // no data
		}).not.toThrow();

		// App is still alive (handler swallowed everything).
		expect(screen.getByText('Identity Verification')).toBeInTheDocument();
		await waitFor(() => expect(global.fetch).toHaveBeenCalled());
	});
});

// Poll/token lifecycle — the prod failure surface (issues #1 + #2).
// jsdom + fake timers drive the bounded poll loop deterministically.
describe('poll + signed-token lifecycle', () => {
	const VIEWER = { id: 42, id_data: {} }; // hxStatus 0 → CTA enabled

	function routedFetch(handler) {
		const calls = [];
		const fn = jest.fn((url) => {
			const u = String(url);
			calls.push(u);
			if (u.indexOf(MANIFEST) !== -1) {
				return Promise.resolve({ ok: false, json: async () => ({}) });
			}
			return Promise.resolve({ ok: true, json: async () => handler(u) });
		});
		fn.calls = calls;
		return fn;
	}

	// Advance the 3s poll cadence one cycle, flushing fetch→json microtasks.
	async function pollCycle(n = 1) {
		for (let i = 0; i < n; i++) {
			// eslint-disable-next-line no-await-in-loop
			await act(async () => { await jest.advanceTimersByTimeAsync(3100); });
		}
	}

	test('#1: keeps polling through in_review and surfaces a later manual verdict without reload', async () => {
		jest.useFakeTimers();
		const seq = ['in_progress', 'in_review', 'in_review', 'in_review', 'failed'];
		let i = 0;
		global.fetch = routedFetch(() => ({ status: seq[Math.min(i++, seq.length - 1)] }));

		render(React.createElement(FaceVaultKYC, makeProps({ user: VIEWER, meta: BASE_META })));
		// componentDidMount auto-starts polling (slug + ext present) — no click.
		await pollCycle(6);

		// Saw in_review repeatedly but never stopped; resolved on the later
		// manual 'failed' with no remount/reload.
		expect(screen.getByText('Verification failed')).toBeInTheDocument();
		const statusCalls = global.fetch.calls.filter(
			(u) => u.indexOf('/external_users/status') !== -1
		);
		expect(statusCalls.length).toBeGreaterThanOrEqual(4); // polled past in_review
	});

	test('#2: a token arriving minutes after launch is consumed → switches to ?token=; legacy stays a fallback', async () => {
		jest.useFakeTimers();
		const fakePop = { closed: false };
		window.open = jest.fn(() => fakePop);
		// Legacy never resolves past in_review; only the token path passes.
		global.fetch = routedFetch((u) =>
			u.indexOf('token=') !== -1 ? { status: 'passed' } : { status: 'in_review' }
		);

		render(React.createElement(FaceVaultKYC, makeProps({ user: VIEWER, meta: BASE_META })));
		fireEvent.click(screen.getByRole('button', { name: /Verify My Identity/i }));

		await pollCycle(3);
		// Legacy alone never resolves and never reached the token path.
		expect(global.fetch.calls.some((u) => u.indexOf('token=') !== -1)).toBe(false);
		expect(screen.queryByText('Verified by FaceVault')).not.toBeInTheDocument();

		// /v/<slug>/done postMessages the signed token minutes later.
		await act(async () => {
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'fv_poll_token', token: 'SIGNED.JWT.AAA' },
				origin: 'https://facevault.id',
				source: fakePop,
			}));
			await Promise.resolve();
		});
		await pollCycle(3);

		expect(global.fetch.calls.some((u) => u.indexOf('token=SIGNED.JWT.AAA') !== -1)).toBe(true);
		expect(screen.getByText('Verified by FaceVault')).toBeInTheDocument();
	});

	test('#2: origin guard is exact — trailing-slash origin rejected, exact accepted', async () => {
		jest.useFakeTimers();
		const fakePop = { closed: false };
		window.open = jest.fn(() => fakePop);
		global.fetch = routedFetch((u) =>
			u.indexOf('token=') !== -1 ? { status: 'passed' } : { status: 'in_review' }
		);

		render(React.createElement(FaceVaultKYC, makeProps({ user: VIEWER, meta: BASE_META })));
		fireEvent.click(screen.getByRole('button', { name: /Verify My Identity/i }));
		await pollCycle(1);

		// https://facevault.id/ (trailing slash) !== the exact origin → ignored.
		await act(async () => {
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'fv_poll_token', token: 'BADORIGIN' },
				origin: 'https://facevault.id/',
				source: fakePop,
			}));
			await Promise.resolve();
		});
		await pollCycle(2);
		expect(global.fetch.calls.some((u) => u.indexOf('token=') !== -1)).toBe(false);

		// Exact origin → accepted.
		await act(async () => {
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'fv_poll_token', token: 'GOODORIGIN' },
				origin: 'https://facevault.id',
				source: fakePop,
			}));
			await Promise.resolve();
		});
		await pollCycle(2);
		expect(global.fetch.calls.some((u) => u.indexOf('token=GOODORIGIN') !== -1)).toBe(true);
	});

	test('#2 (prod finding #4): a late token is consumed even if the poll loop had already exited', async () => {
		jest.useFakeTimers();
		const fakePop = { closed: false };
		window.open = jest.fn(() => fakePop);
		// Legacy resolves to a terminal 'failed' immediately → the loop
		// STOPS (mirrors the prod case where polling had already exited
		// before /done postMessaged the token). The token path passes.
		global.fetch = routedFetch((u) =>
			u.indexOf('token=') !== -1 ? { status: 'passed' } : { status: 'failed' }
		);

		render(React.createElement(FaceVaultKYC, makeProps({ user: VIEWER, meta: BASE_META })));
		fireEvent.click(screen.getByRole('button', { name: /Verify My Identity/i }));
		await pollCycle(3); // legacy → failed → _stopPolling(); loop is dead
		expect(global.fetch.calls.some((u) => u.indexOf('token=') !== -1)).toBe(false);

		// Token arrives after the loop exited — _onPollToken must revive it.
		await act(async () => {
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'fv_poll_token', token: 'REVIVE.AAA' },
				origin: 'https://facevault.id',
				source: fakePop,
			}));
			await Promise.resolve();
		});
		await pollCycle(3);
		expect(global.fetch.calls.some((u) => u.indexOf('token=REVIVE.AAA') !== -1)).toBe(true);
		expect(screen.getByText('Verified by FaceVault')).toBeInTheDocument();
	});

	test('#2: a token captured while the component is unmounted is re-adopted on remount', async () => {
		jest.useFakeTimers();
		const fakePop = { closed: false };
		window.open = jest.fn(() => fakePop);
		global.fetch = routedFetch((u) =>
			u.indexOf('token=') !== -1 ? { status: 'passed' } : { status: 'in_review' }
		);
		const props = makeProps({ user: VIEWER, meta: BASE_META });

		const { unmount } = render(React.createElement(FaceVaultKYC, props));
		fireEvent.click(screen.getByRole('button', { name: /Verify My Identity/i }));
		await pollCycle(1);

		// HollaEx tears the webview down mid-flow.
		unmount();
		// /done postMessages AFTER unmount — the module channel listener is
		// still alive and captures the token into _verifyChannel.token.
		await act(async () => {
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'fv_poll_token', token: 'LATELATE' },
				origin: 'https://facevault.id',
				source: fakePop,
			}));
			await Promise.resolve();
		});

		// Remount: componentDidMount must re-adopt the captured token.
		render(React.createElement(FaceVaultKYC, props));
		await pollCycle(3);
		expect(global.fetch.calls.some((u) => u.indexOf('token=LATELATE') !== -1)).toBe(true);
	});
});
