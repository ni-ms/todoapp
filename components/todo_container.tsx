'use client'
import React, {useState} from 'react'
import StepItem from './step_item';

export interface Step {
    id: number;
    title: string;
    status: 'Todo' | 'Doing' | 'Done';
}

export interface Todo {
    id: number;
    title: string;
    description: string | null;
    priority: number | null;
    steps: Step[] | null;
    tags: string[] | null;
    status: 'Todo' | 'Doing' | 'Done';
}

interface TodoContainerProps {
    day: string;
    todos: Todo[];
}

const TodoContainer = ({day, todos, onSaveTodo, onDeleteTodo}: TodoContainerProps & {onSaveTodo: (id: number, newTodo: Todo) => void, onDeleteTodo: (id: number) => void}) => {

    const [editing, setEditing] = useState<number | null>(null);

    const [title, setTitle] = useState<string>("");
    const [priority, setPriority] = useState<number | null>(null);
    const [description, setDescription] = useState<string | null>("");
    const [tagsInput, setTagsInput] = useState("");
    const [status, setStatus] = useState<'Todo' | 'Doing' | 'Done'>('Todo');

    const handleEditClick = (id: number) => {
        const todo = todos.find(todo => todo.id === id);
        if (todo) {
            setTitle(todo.title);
            setPriority(todo.priority);
            setDescription(todo.description);
            setTagsInput(todo.tags?.join(", ") ?? "");
            setStatus(todo.status);
            setEditing(id);
        }
    }

    const handleCancelClick = () => {
        setEditing(null);
    }

    const handleSaveClick = (id: number) => {
        const existing = todos.find(todo => todo.id === id);
        if (!existing) return;
        const newTodo: Todo = {
            ...existing,
            id,
            title,
            description,
            priority,
            tags: tagsInput.split(",").map(tag => tag.trim()).filter(Boolean),
            status,
        };
        onSaveTodo(id, newTodo);
        setEditing(null);
    }

    const handleDeleteClick = (id: number) => {
        onDeleteTodo(id);
        setEditing(null);
    }

    return (
        <div className="bg-gray-900 shadow-md rounded px-4 pt-6 pb-8 mb-4 flex flex-col">
            <h2 className="mb-4 font-bold text-xl">{day}</h2>
            <div>
                {todos.map(todo => (
                    <div key={todo.id} className="mb-4 bg-gray-600 rounded-lg p-2">
                        {editing === todo.id ? (
                            <>
                                <label className="block text-gray-700 text-sm font-bold mb-2"
                                       htmlFor="title">Title:</label>
                                <input
                                    id="title"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    type="text" value={title} onChange={(e) => setTitle(e.target.value)}/>

                                <label className="block text-gray-700 text-sm font-bold mb-2"
                                       htmlFor="priority">Priority:</label>
                                <input
                                    id="priority"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    type="number" value={priority ?? ""}
                                    onChange={(e) => setPriority(e.target.value === "" ? null : Number(e.target.value))}/>

                                <label className="block text-gray-700 text-sm font-bold mb-2"
                                       htmlFor="description">Description:</label>
                                <input
                                    id="description"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    type="text" value={description || ""}
                                    onChange={(e) => setDescription(e.target.value)}/>

                                <label className="block text-gray-700 text-sm font-bold mb-2"
                                       htmlFor="tags">Tags:</label>
                                <input
                                    id="tags"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    type="text" value={tagsInput}
                                    onChange={(e) => setTagsInput(e.target.value)}/>

                                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="status">Status:</label>
                                <select
                                    id="status"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    value={status} onChange={(e) => setStatus(e.target.value as Todo['status'])}>
                                    <option value="Todo">Todo</option>
                                    <option value="Doing">Doing</option>
                                    <option value="Done">Done</option>
                                </select>
                                <button
                                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-2"
                                    onClick={handleCancelClick}>Cancel
                                </button>
                                <button
                                    className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mt-2"
                                    onClick={() => handleSaveClick(todo.id)}>Save
                                </button>
                                <button
                                    className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded mt-2"
                                    onClick={() => handleDeleteClick(todo.id)}>Delete
                                </button>
                            </>
                        ) : (
                            <>
                                <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                                        onClick={() => handleEditClick(todo.id)}>Edit
                                </button>
                                <div className="flex justify-between items-center">
                                    <h3 className="font-bold text-lg">{todo.title}</h3>
                                </div>
                                <h4 className="mb-2">Priority: {todo.priority}</h4>
                                <p className="mb-2">{todo.description}</p>
                                <p className="mb-2">Tags: {todo.tags?.join(", ")}</p>
                                <p className="mb-2">Status: {todo.status}</p>
                                {todo.steps && <StepItem steps={todo.steps} onSaveStep={(step) => onSaveTodo(todo.id, {...todo, steps: todo.steps?.map(existing => existing.id === step.id ? step : existing) ?? null})}/>}
                            </>
                        )}

                    </div>
                ))}
            </div>
        </div>
    )
}

export default TodoContainer