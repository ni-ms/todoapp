import React, { useState } from "react";

interface CalendarComponentProps {
    daysOfWeek: string[];
    dates: number[];
}

export default function CalendarComponent({ daysOfWeek, dates }: CalendarComponentProps) {
    const [selectedDays, setSelectedDays] = useState<string[]>([]);

    const handleDayClick = (day: string) => {
        setSelectedDays((prevSelectedDays) =>
            prevSelectedDays.includes(day)
                ? prevSelectedDays.filter((d) => d !== day)
                : [...prevSelectedDays, day]
        );
    };

    return (
        <>
            <div className="flex items-center justify-center py-8 px-4">
                <div className="2xl:w-1/3 xl:w-1/2 lg:w-3/5 sm:w-4/5 w-full shadow-lg">
                    <div className="md:p-16 md:pb-12 p-5 dark:bg-gray-800 bg-white rounded-t">
                        <div className="px-4 flex items-center justify-between">
                            <h1 className="text-2xl font-bold dark:text-gray-100 text-gray-800">October 2020</h1>
                            <div className="flex items-center text-gray-800 dark:text-gray-100">
                                <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler icon-tabler-chevron-left" width={24} height={24} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                                    <polyline points="15 6 9 12 15 18" />
                                </svg>
                                <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler ml-3 icon-tabler-chevron-right" width={24} height={24} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                                    <polyline points="9 6 15 12 9 18" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex items-center justify-between pt-12 overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                <tr>
                                    {daysOfWeek.map((day) => (
                                        <th key={day}>
                                            <div className="w-full flex justify-center">
                                                <p
                                                    className={`text-2xl font-medium text-center cursor-pointer ${selectedDays.includes(day) ? "text-blue-600" : "text-gray-800 dark:text-gray-100"}`}
                                                    onClick={() => handleDayClick(day)}
                                                >
                                                    {day}
                                                </p>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                                </thead>
                                <tbody>
                                {dates.map((date) => (
                                    <tr key={date}>
                                        <td className="pt-6">
                                            <div className="px-4 py-4 cursor-pointer flex w-full justify-center">
                                                <p className="text-2xl text-gray-500 dark:text-gray-100 font-medium">{date}</p>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {/*TODO: Show a brief description of existing tasks on a given date */}
                    {/*<div className="md:py-8 py-5 md:px-16 px-5 dark:bg-gray-700 bg-gray-50 rounded-b">*/}
                    {/*    <div className="px-4">*/}
                    {/*        <div className="border-b pb-4 border-gray-400 border-dashed">*/}
                    {/*            <p className="text-xs font-light leading-3 text-gray-500 dark:text-gray-300">9:00 AM</p>*/}
                    {/*            <p className="text-lg font-medium leading-5 text-gray-800 dark:text-gray-100 pt-2">Zoom call with design team</p>*/}
                    {/*            <p className="text-sm pt-2 leading-4 leading-none text-gray-600 dark:text-gray-300">Discussion on UX sprint and Wireframe review</p>*/}
                    {/*        </div>*/}
                    {/*        <div className="border-b pb-4 border-gray-400 border-dashed pt-5">*/}
                    {/*            <p className="text-xs font-light leading-3 text-gray-500 dark:text-gray-300">10:00 AM</p>*/}
                    {/*            <p className="text-lg font-medium leading-5 text-gray-800 dark:text-gray-100 pt-2">Orientation session with new hires</p>*/}
                    {/*        </div>*/}
                    {/*        <div className="border-b pb-4 border-gray-400 border-dashed pt-5">*/}
                    {/*            <p className="text-xs font-light leading-3 text-gray-500 dark:text-gray-300">9:00 AM</p>*/}
                    {/*            <p className="text-lg font-medium leading-5 text-gray-800 dark:text-gray-100 pt-2">Zoom call with design team</p>*/}
                    {/*            <p className="text-sm pt-2 leading-4 leading-none text-gray-600 dark:text-gray-300">Discussion on UX sprint and Wireframe review</p>*/}
                    {/*        </div>*/}
                    {/*    </div>*/}
                    {/*</div>*/}
                </div>
            </div>
        </>
    );
}