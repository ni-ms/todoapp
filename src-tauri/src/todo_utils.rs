use crate::todo_utils::todolist::{Day, TodoList};
use crate::todo_utils::week::Week;
use std::collections::HashMap;

pub mod stepitem;
pub mod todoitem;
pub mod todolist;

/*
///TODO: Implement the builder pattern
Functions to be used in the main.rs file
1. Create_todo_list
2. Create_todo_item
3. Create_step_item
4. Get all data ( sorted according to date and priority )
*/

pub mod week {
    use crate::todo_utils::todolist::{Day, TodoList};
    use std::collections::HashMap;

    pub struct Week {
        days: HashMap<Day, Vec<TodoList>>,
    }

    impl Week {
        pub fn new() -> Self {
            let days = HashMap::new();
            Self { days }
        }

        pub fn initialize_week() -> HashMap<Day, Vec<TodoList>> {
            let mut week = HashMap::new();
            week.insert(Day::Monday, Vec::new());
            week.insert(Day::Tuesday, Vec::new());
            week.insert(Day::Wednesday, Vec::new());
            week.insert(Day::Thursday, Vec::new());
            week.insert(Day::Friday, Vec::new());
            week.insert(Day::Saturday, Vec::new());
            week.insert(Day::Sunday, Vec::new());
            week
        }
        pub fn initialize_week_days(days: Vec<Day>) -> HashMap<Day, Vec<TodoList>> {
            let mut week = HashMap::new();
            for day in days {
                week.insert(day, Vec::new());
            }
            week
        }

        pub fn add_todo_list(&mut self, day: Day, todo_list: TodoList) {
            let entry = self.days.entry(day).or_insert_with(Vec::new);
            entry.push(todo_list);
        }

        pub fn get_todo_lists(&self, day: Day) -> Option<&Vec<TodoList>> {
            self.days.get(&day)
        }

        pub fn remove_todo_list(&mut self, day: Day, id: i32) {
            if let Some(todo_lists) = self.days.get_mut(&day) {
                todo_lists.retain(|todo_list| todo_list.id != id);
            }
        }
    }
}

pub fn create_todo_list(
    id: i32,
    title: String,
    date: String,
    day: Day,
    last_save_time_stamp: Option<String>,
    items: Vec<todoitem::TodoItem>,
) -> TodoList {
    TodoList::create(id, title, date, day, last_save_time_stamp, items)
}

pub fn use_create_todo_list_n_days(days: Vec<Day>) -> HashMap<Day, Vec<TodoList>> {
    Week::initialize_week_days(days)
}

pub fn print_todo_list(todo_list: &TodoList) {
    println!("TodoList id: {}", todo_list.id);
    println!("Title: {}", todo_list.title);
    println!("Date: {}", todo_list.date);
    println!("Day: {:?}", todo_list.day);
    println!("Last save timestamp: {:?}", todo_list.last_save_time_stamp);

    println!("Items:");
    for item in &todo_list.items {
        println!("====================");
        println!("  Item id: {}", item.id);
        println!("  Title: {}", item.title);
        println!("  Description: {:?}", item.description);
        println!("  Priority: {:?}", item.priority);
        println!("  Steps:");

        if item.steps.is_some() {
            for step in item.steps.clone().unwrap() {
                println!("--------------------");
                println!("    Step id: {}", step.id);
                println!("    Title: {}", step.title);
                println!("    Status: {:?}", step.status);
                println!("--------------------");
            }
        }
        println!("  Tags: {:?}", item.tags);
        println!("  Status: {:?}", item.status);
        println!("====================");
    }
}

pub fn create_todo_item(
    id: i32,
    title: String,
    description: Option<String>,
    priority: Option<i32>,
    steps: Option<Vec<stepitem::StepItem>>,
    tags: Option<Vec<String>>,
    status: todoitem::Status,
) -> todoitem::TodoItem {
    todoitem::TodoItem::create(id, title, description, priority, steps, tags, status)
}

pub fn create_step_item(id: i32, title: String, status: stepitem::Status) -> stepitem::StepItem {
    stepitem::StepItem::create(id, title, status)
}

pub fn add_step_to_todo_item(todo_item: &mut todoitem::TodoItem, step: stepitem::StepItem) {
    let mut steps = todo_item.steps.clone().unwrap_or_else(|| vec![]);
    steps.push(step);
    todo_item.steps = Some(steps);
}

pub fn add_todo_item_to_todo_list(todo_list: &mut TodoList, todo_item: todoitem::TodoItem) {
    todo_list.items.push(todo_item);
}

pub fn get_todo_item(todo_list: &TodoList, id: i32) -> Option<&todoitem::TodoItem> {
    for item in &todo_list.items {
        if item.id == id {
            return Some(item);
        }
    }
    None
}

pub fn get_step_from_todo_item(
    todo_item: &todoitem::TodoItem,
    id: i32,
) -> Option<stepitem::StepItem> {
    for step in todo_item.steps.as_ref()?.iter() {
        if step.id == id {
            return Some(step.clone());
        }
    }
    None
}

pub fn delete_todo_item_from_todo_list(todo_list: &mut TodoList, id: i32) {
    let mut index = 0;
    for (i, item) in todo_list.items.iter().enumerate() {
        if item.id == id {
            index = i;
            break;
        }
    }
    todo_list.items.remove(index);
}

pub fn delete_step_from_todo_item(todo_item: &mut todoitem::TodoItem, id: i32) {
    let mut index = 0;
    for (i, step) in todo_item.steps.clone().unwrap().iter().enumerate() {
        if step.id == id {
            index = i;
            break;
        }
    }
    let mut steps = todo_item.steps.clone().unwrap();
    steps.remove(index);
    todo_item.steps = Some(steps);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_modify_todo_list() {
        let mut todo_list = create_todo_list(
            1,
            "Test".to_string(),
            "2022-01-01".to_string(),
            Day::Monday,
            Some("2022-01-01T00:00:00Z".to_string()),
            vec![],
        );

        let mut todo_item1 = create_todo_item(
            1,
            "Test 1".to_string(),
            Some("Description".to_string()),
            Some(1),
            None,
            None,
            todoitem::Status::Todo,
        );
        let mut todo_item2 = create_todo_item(
            2,
            "Test 2".to_string(),
            Some("Description".to_string()),
            Some(1),
            None,
            None,
            todoitem::Status::Todo,
        );
        let mut todo_item3 = create_todo_item(
            3,
            "Test 3".to_string(),
            Some("Description".to_string()),
            Some(1),
            None,
            None,
            todoitem::Status::Todo,
        );
        let mut todo_item4 = create_todo_item(
            4,
            "Test 4".to_string(),
            Some("Description".to_string()),
            Some(1),
            None,
            None,
            todoitem::Status::Todo,
        );
        let mut todo_item5 = create_todo_item(
            5,
            "Test 5".to_string(),
            Some("Description".to_string()),
            Some(1),
            None,
            None,
            todoitem::Status::Todo,
        );

        let step1 = create_step_item(10, "Step 1 for Test 1".to_string(), stepitem::Status::Todo);
        let step2 = create_step_item(11, "Step 2 for Test 1".to_string(), stepitem::Status::Todo);

        add_step_to_todo_item(&mut todo_item1, step1);
        add_step_to_todo_item(&mut todo_item1, step2);

        add_todo_item_to_todo_list(&mut todo_list, todo_item1);
        add_todo_item_to_todo_list(&mut todo_list, todo_item2);
        add_todo_item_to_todo_list(&mut todo_list, todo_item3);
        add_todo_item_to_todo_list(&mut todo_list, todo_item4);
        add_todo_item_to_todo_list(&mut todo_list, todo_item5);

        print_todo_list(&todo_list);
    }

    #[test]
    fn create_and_modify_weekly_todo() {
        // Create a new Week
        let mut week = Week::new();

        // Create a new TodoList
        let mut todo_list = create_todo_list(
            1,
            "Test".to_string(),
            "2022-01-01".to_string(),
            Day::Monday,
            Some("2022-01-01T00:00:00Z".to_string()),
            vec![],
        );

        // Create a new TodoItem
        let mut todo_item1 = create_todo_item(
            1,
            "Test 1".to_string(),
            Some("Description".to_string()),
            Some(1),
            None,
            None,
            todoitem::Status::Todo,
        );

        // Add the TodoItem to the TodoList
        add_todo_item_to_todo_list(&mut todo_list, todo_item1.clone());

        // Add the TodoList to the Week on Monday
        week.add_todo_list(Day::Monday, todo_list.clone());

        // Check if the TodoList was added correctly
        let todo_lists = week.get_todo_lists(Day::Monday).unwrap();
        assert_eq!(todo_lists.len(), 1);
        assert_eq!(todo_lists[0], todo_list);

        // Check if the TodoItem was added correctly
        let todo_items = &todo_lists[0].items;
        assert_eq!(todo_items.len(), 1);
        assert_eq!(todo_items[0], todo_item1);
    }
}
