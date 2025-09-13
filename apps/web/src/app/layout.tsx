import React from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Local Influencers",
	description: "Starter Next.js app in a typed monorepo",
};

export default function RootLayout(props: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">
				<div className="mx-auto max-w-4xl p-6">
					<header className="mb-8">
						<h1 className="text-2xl font-semibold">Local Influencers</h1>
					</header>
					<main>{props.children}</main>
					<footer className="mt-12 text-sm text-neutral-500">© {new Date().getFullYear()}</footer>
				</div>
			</body>
		</html>
	);
}
