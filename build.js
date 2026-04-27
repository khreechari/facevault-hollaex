#!/usr/bin/env node
/**
 * FaceVault KYC Plugin — Build Script
 *
 * Generates the plugin JSON file that can be uploaded to HollaEx.
 * Reads config.json, server.js, and web views, then composes the
 * final plugin object.
 *
 * Usage:
 *   node build.js              # outputs facevault-kyc.json
 *   node build.js --minify     # minified output
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const minify = process.argv.includes('--minify');

// Hosted webview bundle URL. The bundle is the webpack-compiled output of
// web/views/Main.js (see webpack.config.js). HollaEx fetches this URL at
// render time, so to ship a webview change you must (1) rebuild the bundle
// and (2) update the file at public/plugins/facevault-kyc-view.js in the
// site repo before regenerating the plugin JSON.
const WEBVIEW_BUNDLE_URL = 'https://facevault.id/plugins/facevault-kyc-view.js';

// Read source files
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const serverScript = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Compose plugin JSON
const plugin = {
	name: config.name,
	version: config.version,
	type: config.type,
	author: config.author,
	bio: config.bio,
	description: config.description,
	documentation: config.documentation,
	logo: config.logo,
	icon: config.icon,
	url: config.url,
	meta: config.meta,
	public_meta: config.public_meta,
	prescript: config.prescript,
	postscript: config.postscript,
	script: serverScript,
	web_view: [
		{
			// Mount inside HollaEx's KYC verification page (not as a standalone
			// route). is_page: true used to create a blank "Under construction"
			// page; is_verification_tab + type: "home" injects into the existing
			// verification SmartTarget.
			src: WEBVIEW_BUNDLE_URL,
			meta: {
				is_verification_tab: true,
				type: 'home',
				string: {
					id: 'FACEVAULT_KYC_VERIFICATION',
					value: 'Identity Verification'
				},
				icon: {
					id: 'FACEVAULT_SHIELD_ICON',
					value: 'data:image/svg+xml;base64,' + Buffer.from(
						'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>'
					).toString('base64'),
				},
			},
		},
	],
	admin_view: null,
};

// Write output
const output = minify
	? JSON.stringify(plugin)
	: JSON.stringify(plugin, null, 2);

const outFile = path.join(ROOT, 'facevault-kyc.json');
fs.writeFileSync(outFile, output);

const size = (Buffer.byteLength(output) / 1024).toFixed(1);
console.log('Built: ' + outFile + ' (' + size + ' KB)');
