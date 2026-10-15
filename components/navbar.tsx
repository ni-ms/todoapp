import Link from "next/link";

export default function Navbar() {
    return (
        <nav className="flex items-center justify-between p-6 bg-blue-500">
            <div className="text-white">
                <Link href="/" className="text-2xl font-bold bg-transparent border border-white px-4 py-2 rounded cursor-pointer hover:bg-white hover:text-blue-500 transition duration-200">Home
                </Link>
            </div>
            <div>
                <Link href="/settings" className="text-white bg-transparent border border-white px-4 py-2 rounded cursor-pointer hover:bg-white hover:text-blue-500 transition duration-200">Settings
                </Link>
            </div>
        </nav>
    );
}