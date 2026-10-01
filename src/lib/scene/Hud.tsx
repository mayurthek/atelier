'use client';

import { useEffect } from 'react';
import { useShowStore } from './store';
import { CAMERA_STATE_ORDER } from './camera';
import { PALETTE } from './stage-config';

/**
 * §16 controls, §18 look interaction, and the state read-out.
 *
 * Deliberately restrained. Product principle 01: fashion is the interface, UI
 * never overpowers the garments. Everything here is small, low-contrast and
 * fades back while the show is running.
 */

const PHASE_LABELS: Record<string, string> = {
	entrance: 'Entrance',
	walk: 'Walk',
	pose: 'Pose',
	turn: 'Turn',
	exit: 'Exit',
};

export function Hud(): React.ReactElement {
	const playing = useShowStore((s) => s.playing);
	const phase = useShowStore((s) => s.phase);
	const lookIndex = useShowStore((s) => s.lookIndex);
	const totalLooks = useShowStore((s) => s.totalLooks);
	const travel = useShowStore((s) => s.travel);
	const cameraState = useShowStore((s) => s.cameraState);
	const figure = useShowStore((s) => s.figure);
	const perfTier = useShowStore((s) => s.perfTier);
	const ready = useShowStore((s) => s.ready);

	const togglePlaying = useShowStore((s) => s.togglePlaying);
	const nextLook = useShowStore((s) => s.nextLook);
	const prevLook = useShowStore((s) => s.prevLook);
	const setCameraState = useShowStore((s) => s.setCameraState);
	const setInspecting = useShowStore((s) => s.setInspecting);
	const inspecting = useShowStore((s) => s.inspecting);
	const setFigure = useShowStore((s) => s.setFigure);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			const target = event.target as HTMLElement | null;
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
			switch (event.key) {
				case 'c':
				case 'C':
					// Cycle the §17 camera states for demonstration.
					const index = CAMERA_STATE_ORDER.indexOf(cameraState);
					setCameraState(CAMERA_STATE_ORDER[(index + 1) % CAMERA_STATE_ORDER.length]!);
					break;
				case 'f':
				case 'F':
					setFigure(figure === 'male' ? 'female' : 'male');
					break;
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [cameraState, figure, setCameraState, setFigure]);

	return (
		<div
			style={{
				position: 'absolute',
				inset: 0,
				pointerEvents: 'none',
				fontFamily: 'var(--font-grotesk, system-ui, sans-serif)',
				color: PALETTE.warmWhite,
			}}
		>
			{/* §18: the look card. Appears over the runway, restrained. */}
			<div
				style={{
					position: 'absolute',
					left: '2.4rem',
					bottom: '2.2rem',
					display: 'flex',
					flexDirection: 'column',
					gap: '0.55rem',
					opacity: ready ? 1 : 0,
					transition: 'opacity 600ms ease',
				}}
			>
				<div style={{ fontSize: '0.62rem', letterSpacing: '0.4em', opacity: 0.55 }}>
					LOOK {String(lookIndex + 1).padStart(2, '0')} / {String(totalLooks).padStart(2, '0')}
				</div>
				<div
					style={{
						fontFamily: 'var(--font-serif, Georgia, serif)',
						fontSize: '1.05rem',
						letterSpacing: '0.02em',
					}}
				>
					MARTIN MARGIELA
				</div>
				<div style={{ fontSize: '0.62rem', letterSpacing: '0.28em', opacity: 0.45 }}>
					SPRING / SUMMER 1997 · PARIS
				</div>
				<div style={{ fontSize: '0.58rem', letterSpacing: '0.22em', opacity: 0.4, marginTop: '0.2rem' }}>
					{PHASE_LABELS[phase] ?? phase} · {travel.toFixed(1)}m
				</div>
			</div>

			{/* §16 controls, bottom right. */}
			<div
				style={{
					position: 'absolute',
					right: '2.4rem',
					bottom: '2.2rem',
					display: 'flex',
					gap: '0.5rem',
					alignItems: 'center',
					pointerEvents: 'auto',
					opacity: ready ? 0.75 : 0,
					transition: 'opacity 600ms ease',
				}}
			>
				<Button onClick={prevLook} label="←">
					← PREV
				</Button>
				<Button onClick={togglePlaying} label={playing ? 'Pause' : 'Play'}>
					{playing ? 'PAUSE' : 'PLAY'}
				</Button>
				<Button onClick={nextLook} label="Next">
					NEXT →
				</Button>
				<Button
					onClick={() => setInspecting(!inspecting)}
					label="Inspect garment"
					active={inspecting}
				>
					{inspecting ? 'EXIT INSPECT' : 'INSPECT'}
				</Button>
			</div>

			{/* State read-out. Present so the §17 states are demonstrable, but very quiet. */}
			<div
				style={{
					position: 'absolute',
					right: '2.4rem',
					top: '2rem',
					textAlign: 'right',
					fontSize: '0.55rem',
					letterSpacing: '0.2em',
					opacity: 0.35,
					lineHeight: 1.9,
				}}
			>
				<div>CAMERA · {cameraState}</div>
				<div>FIGURE · {figure.toUpperCase()}</div>
				<div>QUALITY · {perfTier}</div>
				<div style={{ opacity: 0.6, marginTop: '0.5rem' }}>
					SPACE pause · ←→ looks · I inspect · C camera · F figure
				</div>
			</div>
		</div>
	);
}

function Button({
	onClick,
	label,
	active,
	children,
}: {
	onClick: () => void;
	label: string;
	active?: boolean;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			style={{
				background: 'transparent',
				border: `1px solid ${active ? PALETTE.warmWhite : 'rgba(232,226,212,0.28)'}`,
				color: PALETTE.warmWhite,
				padding: '0.55rem 0.9rem',
				fontSize: '0.56rem',
				letterSpacing: '0.24em',
				cursor: 'pointer',
				fontFamily: 'inherit',
				transition: 'border-color 240ms ease, background 240ms ease',
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.borderColor = 'rgba(232,226,212,0.7)';
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.borderColor = active
					? PALETTE.warmWhite
					: 'rgba(232,226,212,0.28)';
			}}
		>
			{children}
		</button>
	);
}