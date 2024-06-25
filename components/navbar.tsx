import Link from "next/link";

export default function Navbar() {
    return (
        <nav className="flex items-center justify-between p-6 bg-blue-500">
            <div className="text-white">
                <Link href="/">
                    <button className="text-2xl font-bold bg-transparent border border-white px-4 py-2 rounded cursor-pointer hover:bg-white hover:text-blue-500 transition duration-200">Home</button>
                </Link>
            </div>
            <div>
                <Link href="/settings">
                    <button className="text-white bg-transparent border border-white px-4 py-2 rounded cursor-pointer hover:bg-white hover:text-blue-500 transition duration-200">Settings</button>
                </Link>
            </div>
        </nav>
    );
}