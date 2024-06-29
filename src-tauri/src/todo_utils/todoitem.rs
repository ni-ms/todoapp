use super::stepitem::StepItem;
use derive_builder::Builder;
use serde::{Deserialize, Serialize};

#[derive(Clone, Builder, Serialize, Deserialize, Debug, Eq, Hash, PartialEq)]
pub struct TodoItem {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<i32>,
    pub steps: Option<Vec<StepItem>>,
    pub tags: Option<Vec<String>>,
    pub status: Status,
}

#[derive(Clone, Serialize, Deserialize, Debug, Eq, Hash, PartialEq)]
pub enum Status {
    Todo,
    Doing,
    Done,
}

impl TodoItem {
    // Create a new TodoItem
    pub fn create(
        id: i32,
        title: String,
        description: Option<String>,
        priority: Option<i32>,
        steps: Option<Vec<StepItem>>,
        tags: Option<Vec<String>>,
        status: Status,
    ) -> Self {
        Self {
            id,
            title,
            description,
            priority,
            steps,
            tags,
            status,
        }
    }

    // Read a TodoItem
    pub fn read(&self) -> Self {
        self.clone()
    }

    // Update a TodoItem
    pub fn update(
        &mut self,
        title: String,
        description: Option<String>,
        priority: Option<i32>,
        steps: Option<Vec<StepItem>>,
        tags: Option<Vec<String>>,
        status: Status,
    ) {
        self.title = title;
        self.description = description;
        self.priority = priority;
        self.steps = steps;
        self.tags = tags;
        self.status = status;
    }

    // Delete a TodoItem
    pub fn delete(self) {}
}
