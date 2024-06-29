import React, {MouseEventHandler, useState} from 'react'

interface ToolbarProps {
    onFilter: MouseEventHandler<HTMLButtonElement>;
    onSearch: MouseEventHandler<HTMLButtonElement>;
    onNewTodo: MouseEventHandler<HTMLButtonElement>;
}

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (todo: any) => void;
}

const TodoModal = ({isOpen, onClose, onCreate}: ModalProps) => {

    let title = '';

    const [days, setDays] = useState<{
        [key: string]: boolean;
    }>({
        'Monday': false,
        'Tuesday': false,
        'Wednesday': false,
        'Thursday': false,
        'Friday': false,
        'Saturday': false,
        'Sunday': false,
    });

    const handleCreate = () => {
        onCreate({title, days});
        onClose();
    }

    if (!isOpen) return null;

    return (
        <div className="fixed top-0 left-0 w-full h-full bg-gray-800 bg-opacity-50 flex items-center justify-center">
            <div className="bg-white p-4 rounded">
                <h2 className="text-lg font-bold">New Todo</h2>
                <table className="mt-2">
                    <tbody>
                    {Object.keys(days).map(day => (
                        <tr key={day}>
                            <td className="pr-2">
                                <label className="text-gray-700">
                                    {day}
                                </label>
                            </td>
                            <td>
                                <input type="checkbox" checked={days[day]}
                                       onChange={() => setDays({...days, [day]: !days[day]})}
                                       className="form-checkbox h-5 w-5 text-blue-600"
                                />
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
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

    const handleCreate = (todo: any) => {
        onNewTodo(todo);
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