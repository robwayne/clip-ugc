/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // These headers enable cross-origin isolation, which lets ffmpeg.wasm use
  // SharedArrayBuffer (multi-threaded core) when available. The app also works
  // with the single-threaded core if a browser lacks it, so this is best-effort.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default nextConfig;
