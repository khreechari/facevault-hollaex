/**
 * FaceVault KYC Plugin — Web View for HollaEx
 *
 * Main component rendered on the exchange's verification page.
 * Shows verification status and a "Verify Identity" button.
 *
 * Props from HollaEx kit context (via withKit HOC):
 *   user           — Current user object (id, id_data, full_name, ...)
 *   strings        — Localization strings
 *   activeLanguage — Current language code
 */

import React, { Component } from 'react';

const STATUS_LABELS = {
	0: { text: 'Not Verified', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
	1: { text: 'Pending Review', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
	2: { text: 'Rejected', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
	3: { text: 'Verified', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
};

const STYLES = {
	container: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		padding: '32px 24px',
		maxWidth: '420px',
		margin: '0 auto',
	},
	logo: {
		width: '56px',
		height: '56px',
		borderRadius: '16px',
		background: 'linear-gradient(135deg, rgba(74,222,128,0.12), rgba(34,211,238,0.08))',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: '20px',
	},
	title: {
		fontSize: '20px',
		fontWeight: '700',
		marginBottom: '8px',
		textAlign: 'center',
	},
	subtitle: {
		fontSize: '14px',
		opacity: 0.5,
		marginBottom: '28px',
		textAlign: 'center',
		lineHeight: '1.5',
	},
	badge: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '6px',
		padding: '6px 14px',
		borderRadius: '20px',
		fontSize: '13px',
		fontWeight: '600',
		marginBottom: '24px',
	},
	dot: {
		width: '8px',
		height: '8px',
		borderRadius: '50%',
	},
	button: {
		width: '100%',
		padding: '14px 24px',
		border: 'none',
		borderRadius: '12px',
		background: 'linear-gradient(135deg, #4ade80, #22d3ee)',
		color: '#0c0c12',
		fontSize: '15px',
		fontWeight: '700',
		cursor: 'pointer',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '8px',
		transition: 'opacity 0.2s',
	},
	buttonDisabled: {
		opacity: 0.5,
		cursor: 'not-allowed',
	},
	note: {
		fontSize: '12px',
		opacity: 0.4,
		marginTop: '20px',
		textAlign: 'center',
		lineHeight: '1.5',
	},
	features: {
		display: 'flex',
		gap: '12px',
		flexWrap: 'wrap',
		justifyContent: 'center',
		marginBottom: '28px',
	},
	chip: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '4px',
		padding: '4px 10px',
		borderRadius: '16px',
		background: 'rgba(255,255,255,0.04)',
		border: '1px solid rgba(255,255,255,0.06)',
		fontSize: '11px',
		opacity: 0.5,
	},
	rejectedNote: {
		fontSize: '13px',
		color: '#f87171',
		background: 'rgba(248,113,113,0.08)',
		border: '1px solid rgba(248,113,113,0.15)',
		borderRadius: '8px',
		padding: '10px 14px',
		marginBottom: '20px',
		textAlign: 'center',
		width: '100%',
	},
	verifiedCard: {
		width: '100%',
		padding: '16px 20px',
		borderRadius: '12px',
		background: 'rgba(74,222,128,0.06)',
		border: '1px solid rgba(74,222,128,0.12)',
		textAlign: 'center',
	},
};

class FaceVaultKYC extends Component {
	constructor(props) {
		super(props);
		this.state = {
			loading: false,
			error: null,
		};
	}

	startVerification = async () => {
		if (this.state.loading) return;

		this.setState({ loading: true, error: null });

		try {
			const response = await fetch('/plugins/facevault/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
			});

			const data = await response.json();

			if (!response.ok) {
				this.setState({ loading: false, error: data.message || 'Failed to start verification' });
				return;
			}

			// Open FaceVault verification in a new tab
			window.open(data.url, '_blank', 'noopener,noreferrer');

			this.setState({ loading: false });
		} catch (err) {
			this.setState({ loading: false, error: 'Connection error. Please try again.' });
		}
	};

	render() {
		const { user } = this.props;
		const { loading, error } = this.state;
		const idData = (user && user.id_data) || {};
		const status = idData.status || 0;
		const statusInfo = STATUS_LABELS[status] || STATUS_LABELS[0];
		const isVerified = status === 3;
		const isPending = status === 1;
		const isRejected = status === 2;

		return (
			<div style={STYLES.container}>
				{/* Logo */}
				<div style={STYLES.logo}>
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
						<path d="M9 12l2 2 4-4"/>
					</svg>
				</div>

				{/* Title */}
				<div style={STYLES.title}>Identity Verification</div>
				<div style={STYLES.subtitle}>
					{isVerified
						? 'Your identity has been verified successfully.'
						: isPending
						? 'Your verification is being processed.'
						: 'Verify your identity to unlock full exchange access.'}
				</div>

				{/* Status badge */}
				<div style={{
					...STYLES.badge,
					color: statusInfo.color,
					background: statusInfo.bg,
				}}>
					<div style={{ ...STYLES.dot, background: statusInfo.color }} />
					{statusInfo.text}
				</div>

				{/* Verified state */}
				{isVerified && (
					<div style={STYLES.verifiedCard}>
						<div style={{ fontSize: '14px', fontWeight: '600', color: '#4ade80', marginBottom: '4px' }}>
							Verification Complete
						</div>
						<div style={{ fontSize: '12px', opacity: 0.5 }}>
							Powered by FaceVault
						</div>
					</div>
				)}

				{/* Rejected note */}
				{isRejected && idData.note && (
					<div style={STYLES.rejectedNote}>
						{idData.note}
					</div>
				)}

				{/* Features */}
				{!isVerified && !isPending && (
					<div style={STYLES.features}>
						<span style={STYLES.chip}>ID Document</span>
						<span style={STYLES.chip}>Face Match</span>
						<span style={STYLES.chip}>Liveness Check</span>
						<span style={STYLES.chip}>Anti-Spoofing</span>
					</div>
				)}

				{/* Verify button */}
				{!isVerified && (
					<button
						style={{
							...STYLES.button,
							...(loading || isPending ? STYLES.buttonDisabled : {}),
						}}
						onClick={this.startVerification}
						disabled={loading || isPending}
					>
						{loading ? (
							'Starting...'
						) : isPending ? (
							'Verification in Progress'
						) : isRejected ? (
							<>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
								Retry Verification
							</>
						) : (
							<>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
									<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
								</svg>
								Verify My Identity
							</>
						)}
					</button>
				)}

				{/* Error */}
				{error && (
					<div style={{ color: '#f87171', fontSize: '13px', marginTop: '12px', textAlign: 'center' }}>
						{error}
					</div>
				)}

				{/* Footer */}
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
