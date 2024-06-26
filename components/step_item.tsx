import React from 'react'

interface Step {
    id: number;
    title: string;
    status: 'Todo' | 'Doing' | 'Done';
}
const StepItem = ({steps}: {steps: Step[]}) => {
    return (
        <ul className="pl-5 list-disc">
            {steps.map(step => (
                <li key={step.id}>
                    <h4>{step.title}</h4>
                    <p>{step.status}</p>
                </li>
            ))}
        </ul>
    )
}
export default StepItem
