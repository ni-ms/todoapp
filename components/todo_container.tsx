"use client";
import React, { useState } from 'react'
import StepItem from './step_item';

interface Step {
    id: number;
    title: string;
    status: 'Todo' | 'Doing' | 'Done';
}

interface Todo {
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

const TodoContainer = ({day, todos}: TodoContainerProps) => {
    const [editing, setEditing] = useState<number | null>(null);

    const handleEditClick = (id: number) => {
        setEditing(id);
    }

    const handleCancelClick = () => {
        setEditing(null);
    }

    const handleSaveClick = (id: number) => {
        // Save logic here
        setEditing(null);
    }

    const handleDeleteClick = (id: number) => {
        // Delete logic here
        setEditing(null);
    }

    return (
        <div className="bg-gray-900 shadow-md rounded px-4 pt-6 pb-8 mb-4 flex flex-col">
            <h2 className="mb-4 font-bold text-xl">{day}</h2>
            <div>
                {todos.map(todo => (
                    <div key={todo.id} className="mb-4 bg-gray-600 rounded-lg p-2">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-lg">{todo.title}</h3>
                            {editing === todo.id ? (
                                <>
                                    <button onClick={handleCancelClick} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                                        Cancel
                                    </button>
                                    <button onClick={() => handleSaveClick(todo.id)} className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">
                                        Save
                                    </button>
                                    <button onClick={() => handleDeleteClick(todo.id)} className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
                                        Delete
                                    </button>
                                </>
                            ) : (
                                <button onClick={() => handleEditClick(todo.id)} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                                    Edit
                                </button>
                            )}
                        </div>
                        <p className="mb-2">{todo.description}</p>
                        <p className="mb-2">{todo.priority}</p>
                        <p className="mb-2">{todo.tags}</p>
                        <p className="mb-2">{todo.status}</p>
                        {todo.steps && <StepItem steps={todo.steps}/>}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default TodoContainer