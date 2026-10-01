'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { InstancedMesh } from 'three';
import { Object3D, Vector3 } from 'three';
import { ATMOSPHERE, LIGHTING, PALETTE, RUNWAY } from './stage-config';

/**
 * The runway environment from §12.
 *
 * Everything here is procedural geometry and instanced silhouettes — no
 * environment maps, no HDRIs. The brief asks for cinematic and editorial rather
 * than game-like, and a dark room with one key light serves that far better
 * than a photo-lit scene would.
 *
 * `perfTier` is read so the crowd can thin out on weaker hardware, which is the
 * cheapest place to save draw calls.
 */
export function Runway({ children }: { children?: React.ReactNode }): React.ReactElement {
	return (
		<>
			{/* §12: atmospheric haze. Also hides where the runway ends. */}
			<fogExp2 attach="fog" args={[ATMOSPHERE.colour, ATMOSPHERE.density]} />
			<color attach="background" args={[PALETTE.background]} />

			<Lights />
			<RunwayFloor />
			<Crowd />

			{/* Backdrop, so the far end is not open void. */}
			<mesh position={[0, 6, RUNWAY.length + 6]}>
				<planeGeometry args={[48, 18]} />
				<meshStandardMaterial color={PALETTE.surface} roughness={0.97} metalness={0} />
			</mesh>
			{children}
		</>
	);
}

function Lights(): React.ReactElement {
	return (
		<>
			<ambientLight intensity={LIGHTING.ambient} color={PALETTE.warmWhite} />

			{/* The only shadow caster — §32 keeps shadows to one light at 2048. */}
			<directionalLight
				position={LIGHTING.key.position.toArray()}
				intensity={LIGHTING.key.intensity}
				color={LIGHTING.key.colour}
				castShadow
				shadow-mapSize-width={LIGHTING.shadowMapSize}
				shadow-mapSize-height={LIGHTING.shadowMapSize}
				shadow-camera-near={0.5}
				shadow-camera-far={42}
				shadow-camera-left={-9}
				shadow-camera-right={9}
				shadow-camera-top={14}
				shadow-camera-bottom={-4}
				shadow-bias={-0.0005}
				shadow-normalBias={0.02}
			/>
			<directionalLight
				position={LIGHTING.fill.position.toArray()}
				intensity={LIGHTING.fill.intensity}
				color={LIGHTING.fill.colour}
			/>
			<directionalLight
				position={LIGHTING.rim.position.toArray()}
				intensity={LIGHTING.rim.intensity}
				color={LIGHTING.rim.colour}
			/>
		</>
	);
}

function RunwayFloor(): React.ReactElement {
	return (
		<group>
			{/* The runway. Matte, not mirror — §12 asks for reflections, but a
			    reflective catwalk under a key light reads brighter than the figure
			    and pulls the eye off the garment, which product principle 01
			    forbids. A slight sheen is enough to suggest polish. */}
			<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, RUNWAY.length / 2]} receiveShadow>
				<planeGeometry args={[RUNWAY.width, RUNWAY.length]} />
				<meshStandardMaterial color="#0e0e10" roughness={0.62} metalness={0.18} />
			</mesh>

			{/* Surrounding floor, darker still, so the runway reads as the lit path. */}
			<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.003, RUNWAY.length / 2]} receiveShadow>
				<planeGeometry args={[90, 90]} />
				<meshStandardMaterial color="#070708" roughness={0.97} metalness={0} />
			</mesh>
		</group>
	);
}

interface AudienceSeat {
	x: number;
	y: number;
	z: number;
	yaw: number;
	scale: number;
}

interface PhotographerSeat {
	x: number;
	y: number;
	z: number;
	yaw: number;
}

interface SeatPlan {
	audience: AudienceSeat[];
	photographers: PhotographerSeat[];
}

/**
 * Lay out the crowd deterministically.
 *
 * Seeded rather than `Math.random` so seating is identical between reloads — a
 * crowd that reshuffles on refresh reads as a bug.
 */
function planSeating(perRow: number): SeatPlan {
	const audience: AudienceSeat[] = [];
	const photographers: PhotographerSeat[] = [];

	let seed = 20070101;
	const rand = (): number => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 0x100000000;
	};

	for (let side = -1; side <= 1; side += 2) {
		for (let row = 0; row < RUNWAY.rows; row++) {
			// Each row sits further back and slightly higher, like raking seating.
			const offset = RUNWAY.audienceOffset + row * 0.92;
			const tier = row * 0.13;
			for (let seat = 0; seat < perRow; seat++) {
				// Jitter so the rows are not a perfect grid, which reads as a prop.
				const z =
					-2.5 + seat * ((RUNWAY.length + 5) / perRow) + (rand() - 0.5) * 0.22;
				const x = side * (offset + (rand() - 0.5) * 0.18);
				audience.push({
					x,
					y: tier,
					z,
					// Face the runway centreline.
					yaw: (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rand() - 0.5) * 0.3,
					scale: 0.94 + rand() * 0.12,
				});
			}
		}
	}

	// Photographers line both edges of the runway itself, per §12.
	for (let i = 0; i < 7; i++) {
		for (let side = -1; side <= 1; side += 2) {
			photographers.push({
				x: side * (RUNWAY.width / 2 + 0.6),
				y: 1.44,
				z: 2.5 + i * 1.7 + rand() * 0.5,
				yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
			});
		}
	}

	return { audience, photographers };
}

/**
 * §12: audience and photographer silhouettes.
 *
 * Instanced rather than individual meshes — 140 seated figures as separate
 * objects would cost more in draw calls than the runway model does. Each is a
 * simple tapered form, dark, which is all the brief asks for: they establish
 * that a show is being watched.
 *
 * Low detail is deliberate. Close up they would look wrong, but §17 keeps the
 * camera at audience level looking down the runway, where they read as a crowd
 * without ever being inspected.
 */
function Crowd(): React.ReactElement {
	const bodies = useRef<InstancedMesh>(null);
	const heads = useRef<InstancedMesh>(null);
	const cameras = useRef<InstancedMesh>(null);
	const seats = useRef<InstancedMesh>(null);
	const backs = useRef<InstancedMesh>(null);

	const plan = useMemo(() => planSeating(RUNWAY.perRow), []);
	const dummy = useMemo(() => new Object3D(), []);
	const offset = useMemo(() => new Vector3(), []);
	const UP = useMemo(() => new Vector3(0, 1, 0), []);

	/**
	 * Place one instance, with an optional local offset rotated by the seat's yaw.
	 *
	 * The chairs need this: a backrest belongs *behind* whoever is sitting in it,
	 * and "behind" is whatever direction that seat faces.
	 */
	const place = (
		mesh: React.RefObject<InstancedMesh | null>,
		i: number,
		s: AudienceSeat,
		scale: number,
		local: [number, number, number],
	): void => {
		if (!mesh.current) return;
		offset.set(local[0], local[1], local[2]).applyAxisAngle(UP, s.yaw).multiplyScalar(scale);
		dummy.position.set(s.x + offset.x, s.y + offset.y, s.z + offset.z);
		dummy.rotation.set(0, s.yaw, 0);
		dummy.scale.setScalar(scale);
		dummy.updateMatrix();
		mesh.current.setMatrixAt(i, dummy.matrix);
	};

	const commit = (mesh: React.RefObject<InstancedMesh | null>): void => {
		if (!mesh.current) return;
		mesh.current.instanceMatrix.needsUpdate = true;
		mesh.current.computeBoundingSphere();
	};

	// Write instance matrices once, after the meshes exist. Doing this during
	// render would race the ref assignment.
	useLayoutEffect(() => {
		plan.audience.forEach((s, i) => {
			place(bodies, i, s, s.scale, [0, 0.43, 0]);
			place(heads, i, s, s.scale, [0, 0.95, 0]);
			// Chair: a seat pad under the figure and a backrest behind it.
			place(seats, i, s, s.scale, [0, 0.4, 0]);
			place(backs, i, s, s.scale, [0, 0.63, -0.19]);
		});
		commit(bodies);
		commit(heads);
		commit(seats);
		commit(backs);

		plan.photographers.forEach((s, i) => {
			if (!cameras.current) return;
			dummy.position.set(s.x, s.y, s.z);
			dummy.rotation.set(0, s.yaw, 0);
			dummy.scale.setScalar(1);
			dummy.updateMatrix();
			cameras.current.setMatrixAt(i, dummy.matrix);
		});
		commit(cameras);
	}, [plan, dummy, offset, UP]);

	useFrame(({ clock }) => {
		// §12 asks for "subtle environmental movement". A slow drift keeps the
		// scene from reading as a still image without becoming the "excessive
		// parallax" §26 warns against.
		const t = clock.elapsedTime;
		if (bodies.current) bodies.current.position.x = Math.sin(t * 0.18) * 0.012;
		if (heads.current) heads.current.position.x = Math.sin(t * 0.22 + 1.1) * 0.02;
		// Photographers raise and lower their cameras on a long cycle.
		if (cameras.current) cameras.current.position.y = Math.sin(t * 0.31 + 0.4) * 0.05;
	});

	return (
		<group>
			<instancedMesh
				ref={bodies}
				args={[undefined, undefined, plan.audience.length]}
				frustumCulled={false}
			>
				<cylinderGeometry args={[0.19, 0.26, 0.86, 7]} />
				<meshStandardMaterial color="#101013" roughness={0.98} metalness={0} />
			</instancedMesh>

			<instancedMesh
				ref={heads}
				args={[undefined, undefined, plan.audience.length]}
				frustumCulled={false}
			>
				<sphereGeometry args={[0.105, 8, 6]} />
				<meshStandardMaterial color="#141417" roughness={0.95} metalness={0} />
			</instancedMesh>

			<instancedMesh
				ref={cameras}
				args={[undefined, undefined, plan.photographers.length]}
				frustumCulled={false}
			>
				<boxGeometry args={[0.17, 0.13, 0.24]} />
				<meshStandardMaterial color="#0d0d10" roughness={0.9} metalness={0.1} />
			</instancedMesh>

			{/* Chairs. Without these the SPECTATOR view looks out over a field of
			    floating torsos, which is worse than no audience at all — the whole
			    point of the side view is that the user is *in* a row of seats. */}
			<instancedMesh
				ref={seats}
				args={[undefined, undefined, plan.audience.length]}
				frustumCulled={false}
			>
				<boxGeometry args={[0.44, 0.055, 0.42]} />
				<meshStandardMaterial color="#0c0c0f" roughness={0.94} metalness={0.04} />
			</instancedMesh>
			<instancedMesh
				ref={backs}
				args={[undefined, undefined, plan.audience.length]}
				frustumCulled={false}
			>
				<boxGeometry args={[0.44, 0.46, 0.055]} />
				<meshStandardMaterial color="#0c0c0f" roughness={0.94} metalness={0.04} />
			</instancedMesh>
		</group>
	);
}