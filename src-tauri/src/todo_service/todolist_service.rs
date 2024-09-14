// Build the list using singleton and builder design pattern

use std::cell::OnceCell;
use std::sync::Mutex;
use crate::todo_utils::todolist::{Day, TodoList};

struct TodolistSingleton;
static INSTANCE: OnceCell<Mutex<TodoList>> = OnceCell::new();

impl TodolistSingleton {
    pub fn get_instance() -> &'static Mutex<TodoList> {
        TodolistSingleton::INSTANCE.get_or_init(|| {
            Mutex::new(TodoList {
                id: 0,
                date: String::new(),
                day: Day::Monday,
                items: vec![],
                title: "".to_string(),
                last_save_time_stamp: None,
            })
        })
    }

    pub fn set_instance(todo_list: TodoList) {
        let instance = TodolistSingleton::get_instance();
        let mut todo_list_lock = instance.lock().unwrap();
        *todo_list_lock = todo_list;
    }
}