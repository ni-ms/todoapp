import React from 'react'
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
    return (
        <div>
            <h2>{day}</h2>
            <div>
                {todos.map(todo => (
                    <div key={todo.id}>
                        <h3>{todo.title}</h3>
                        <p>{todo.description}</p>
                        <p>{todo.priority}</p>
                        <p>{todo.tags}</p>
                        <p>{todo.status}</p>
                        {todo.steps && <StepItem steps={todo.steps}/>}
                    </div>
                ))}
            </div>
        </div>
    )
}


export default TodoContainer

