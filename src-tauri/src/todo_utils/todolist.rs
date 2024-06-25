use super::todoitem::TodoItem;
use derive_builder::Builder;
use serde::{Deserialize, Serialize};

#[derive(Builder, Serialize, Deserialize)]
pub struct TodoList {
    pub id: i32,
    pub title: String,
    pub date: String,
    pub day: Day,
    pub last_save_time_stamp: Option<String>,
    pub items: Vec<TodoItem>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub enum Day {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

impl TodoList {
    pub fn create(
        id: i32,
        title: String,
        date: String,
        day: Day,
        last_save_time_stamp: Option<String>,
        items: Vec<TodoItem>,
    ) -> Self {
        Self {
            id,
            title,
            date,
            day,
            last_save_time_stamp,
            items,
        }
    }

    // Read a TodoList
    pub fn read(&self) -> &TodoList {
        self
    }

    // Update a TodoList
    pub fn update(
        &mut self,
        title: String,
        date: String,
        day: Day,
        last_save_time_stamp: Option<String>,
        items: Vec<TodoItem>,
    ) {
        self.title = title;
        self.date = date;
        self.day = day;
        self.last_save_time_stamp = last_save_time_stamp;
        self.items = items;
    }

    pub fn delete(self) {}
}
