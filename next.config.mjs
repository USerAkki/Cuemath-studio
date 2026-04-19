/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode helps catch bugs early
  reactStrictMode: true,

  // Security: these env vars are server-only and never sent to the browser
  // Add GEMINI_API_KEY here to ensure it stays server-side
  serverExternalPackages: [],

  // Custom headers for security
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
