import React, {MouseEventHandler, useState} from 'react'

interface ToolbarProps {
    onFilter: MouseEventHandler<HTMLButtonElement>;
    onSearch: MouseEventHandler<HTMLButtonElement>;
    onNewTodo: (title: string) => void;
}

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (title: string) => void;
}

const TodoModal = ({isOpen, onClose, onCreate}: ModalProps) => {

    const [title, setTitle] = useState('');

    const handleCreate = () => {
        if (!title.trim()) return;
        onCreate(title.trim());
        setTitle("");
        onClose();
    }

    if (!isOpen) return null;

    return (
        <div className="fixed top-0 left-0 w-full h-full bg-gray-800/50 flex items-center justify-center">
            <div role="dialog" aria-modal="true" aria-label="New Todo" className="bg-white p-4 rounded">
                <h2 className="text-lg font-bold text-gray-900">New Todo</h2>
                <label className="block text-gray-700" htmlFor="new-todo-title">Title</label>
                <input id="new-todo-title" className="border rounded p-2 text-gray-900" value={title} onChange={event => setTitle(event.target.value)} />
                <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-2"
                        onClick={handleCreate}>Create
                </button>
                <button className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded mt-2"
                        onClick={onClose}>Cancel
                </button>
            </div>
        </div>

    )

}

const Toolbar = ({onFilter, onSearch, onNewTodo}: ToolbarProps) => {

    const [isModalOpen, setModalOpen] = useState(false);

    const handleNewTodoClick = () => {
        setModalOpen(true);
    };

    const handleCreate = (title: string) => {
        onNewTodo(title);
        setModalOpen(false);
    };
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
            <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ml-2"
                    onClick={handleNewTodoClick}>New Todo
            </button>
            <TodoModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} onCreate={handleCreate}/>

            <button
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ml-2"
            >
                View
            </button>
        </div>
    )
}

export default Toolbar