import React, { useState } from 'react'

import type { Step } from './todo_container';

const StepItem = ({steps, onSaveStep}: {steps: Step[]; onSaveStep: (step: Step) => void}) => {
    const [editingStep, setEditingStep] = useState<number | null>(null);
    const [stepTitle, setStepTitle] = useState<string>("");
    const [stepStatus, setStepStatus] = useState<'Todo' | 'Doing' | 'Done'>('Todo');

    const handleEditStepClick = (id: number, title: string, status: 'Todo' | 'Doing' | 'Done') => {
        setEditingStep(id);
        setStepTitle(title);
        setStepStatus(status);
    }

    const handleSaveStepClick = (id: number) => {
        onSaveStep({id, title: stepTitle, status: stepStatus});
        setEditingStep(null);
    }

    const handleStepTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setStepTitle(e.target.value);
    }

    const handleStepStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setStepStatus(e.target.value as 'Todo' | 'Doing' | 'Done');
    }

    return (
        <ul className="pl-5 list-disc">
            {steps.map(step => (
                <li key={step.id}>
                    {editingStep === step.id ? (
                        <>
                            <input value={stepTitle} onChange={handleStepTitleChange} />
                            <select value={stepStatus} onChange={handleStepStatusChange}>
                                <option value="Todo">Todo</option>
                                <option value="Doing">Doing</option>
                                <option value="Done">Done</option>
                            </select>
                            <button onClick={() => handleSaveStepClick(step.id)}>Save</button>
                        </>
                    ) : (
                        <>
                            <h4>{step.title}</h4>
                            <p>{step.status}</p>
                            <button onClick={() => handleEditStepClick(step.id, step.title, step.status)}>Edit</button>
                        </>
                    )}
                </li>
            ))}
        </ul>
    )
}

export default StepItem