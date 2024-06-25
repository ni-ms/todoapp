import TodoContainer from "@/components/todo_container";

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
    return (
        <main>
            <TodoContainer day="Monday" todos={test_todo}/>
        </main>
    );
}
