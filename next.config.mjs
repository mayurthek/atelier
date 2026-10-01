import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,

	// This repository sits inside a larger `projects` git repo, so Turbopack
	// otherwise infers the wrong workspace root and warns about the outer
	// package-lock. Pinning it here keeps builds quiet and reproducible.
	turbopack: { root },

	// The GLBs are served from public/ and streamed by the browser, so nothing
	// needs a cross-origin loader — the bundle stays self-contained.
	experimental: {
		optimizePackageImports: ['@react-three/drei'],
	},
};

export default nextConfig;