/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Uploaded Supabase images are resized through /_next/image (see src/lib/img.ts).
    // Only public Storage objects may be fetched, so the optimizer is not an open proxy.
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
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
