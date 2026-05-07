/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/functions/:path*", destination: `${backend}/functions/:path*` },
    ];
  },
};

module.exports = nextConfig;
