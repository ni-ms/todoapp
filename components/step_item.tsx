import React from 'react'

interface Step {
    id: number;
    title: string;
    status: 'Todo' | 'Doing' | 'Done';
}
const StepItem = ({steps}: {steps: Step[]}) => {
    return (
        <div>
            {steps.map(step => (
                <div key={step.id}>
                    <h4>{step.title}</h4>
                    <p>{step.status}</p>
                </div>
            ))}
        </div>
    )
}
export default StepItem
