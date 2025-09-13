import type { Config } from "tailwindcss";

export default {
	content: ["./src/app/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/shared/src/**/*.{ts,tsx}"],
	theme: {
		extend: {},
	},
	plugins: [],
} satisfies Config;
