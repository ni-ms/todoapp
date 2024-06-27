'use client'
import TodoContainer, {Todo} from "@/components/todo_container";
import {useState} from "react";

const test_todo = [
    {
        id: 1,
        title: 'Test Todo',
        description: 'This is a test todo',
        priority: 1,
        steps: [
            {
                id: 1,
                title: 'Test Step',
                status: 'Todo' as 'Todo',
            }
        ],
        tags: ['Test', 'Todo'],
        status: 'Todo' as 'Todo',
    },
    {
        id: 2,
        title: 'Test Todo 2',
        description: 'This is a test todo 2',
        priority: 2,
        steps: [
            {
                id: 2,
                title: 'Test Step 2',
                status: 'Doing' as 'Doing',
            }
        ],
        tags: ['Test', 'Todo'],
        status: 'Doing' as 'Doing',
    }
];
export default function Home() {
    const [todos, setTodos] = useState<Todo[]>(test_todo);

    const handleSaveTodo = (id: number, newTodo: Todo) => {
        setTodos(todos.map((todo) => todo.id === id ? newTodo : todo));
    }

    const handleDeleteTodo = (id: number) => {
        setTodos(todos.filter((todo: { id: number; }) => todo.id !== id));
    }

    return (
        <main>
            <TodoContainer
                day="Monday"
                todos={todos}
                onSaveTodo={handleSaveTodo}
                onDeleteTodo={handleDeleteTodo}
            />
        </main>
    );
}
