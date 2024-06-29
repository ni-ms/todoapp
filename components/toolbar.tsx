import React, {MouseEventHandler} from 'react'

interface ToolbarProps {
    onFilter: MouseEventHandler<HTMLButtonElement>;
    onSearch: MouseEventHandler<HTMLButtonElement>;
    onNewTodo: MouseEventHandler<HTMLButtonElement>;
}

const Toolbar = ({onFilter, onSearch, onNewTodo}: ToolbarProps) => {
    return (
        <div className="flex items-center justify-end bg-gray-300 p-4 rounded">
            <button
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ml-2"
                onClick={onFilter}
            >
                Filter
            </button>
            <button
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ml-2"
                onClick={onSearch}
            >
                Search
            </button>
            <button
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ml-2"
                onClick={onNewTodo}
            >
                New Todo
            </button>
            <button
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ml-2"
            >
                View
            </button>
        </div>
    )
}

export default Toolbar