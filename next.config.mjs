/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    // Pages supplies its repository path at build time; desktop builds stay at /.
    basePath: process.env.PAGES_BASE_PATH || '',
    trailingSlash: true,
    images: { unoptimized: true },
}
export default nextConfig;
