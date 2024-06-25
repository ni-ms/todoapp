use derive_builder::Builder;
use serde::{Deserialize, Serialize};

#[derive(Clone, Builder, Serialize, Deserialize)]
pub struct StepItem {
    pub id: i32,
    pub title: String,
    pub status: Status,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub enum Status {
    Todo,
    Doing,
    Done,
}

impl StepItem {
    // Create a new StepItem
    pub fn create(id: i32, title: String, status: Status) -> Self {
        Self { id, title, status }
    }

    pub fn read(&self) -> Self {
        self.clone()
    }

    pub fn update(&mut self, title: String, status: Status) {
        self.title = title;
        self.status = status;
    }

    pub fn delete(self) {}
}
