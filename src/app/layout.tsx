import type { Metadata } from 'next';
import { Cormorant_Garamond, Inter_Tight } from 'next/font/google';
import './globals.css';

/**
 * §25 typography: an editorial serif for designer names, collection names and
 * years; a neutral grotesk for navigation, metadata and controls.
 *
 * Cormorant is a high-contrast didone-adjacent face — the register of a fashion
 * masthead rather than a web app. Inter Tight carries the metadata at small sizes
 * without shouting.
 */

const serif = Cormorant_Garamond({
	subsets: ['latin'],
	weight: ['300', '400', '500', '600'],
	style: ['normal', 'italic'],
	display: 'swap',
	variable: '--font-serif',
});

const grotesk = Inter_Tight({
	subsets: ['latin'],
	weight: ['300', '400', '500'],
	display: 'swap',
	variable: '--font-grotesk',
});

export const metadata: Metadata = {
	title: 'ATELIER — Experience fashion history from the front row',
	description:
		'An immersive digital fashion archive. Historical runway documentation, reconstructed as a 3D show.',
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
	return (
		<html lang="en" className={`${serif.variable} ${grotesk.variable}`}>
			<body>{children}</body>
		</html>
	);
}