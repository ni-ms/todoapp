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

pub fn create_todo_list(
    id: i32,
    title: String,
    date: String,
    day: todolist::Day,
    last_save_time_stamp: Option<String>,
    items: Vec<todoitem::TodoItem>,
) -> todolist::TodoList {
    todolist::TodoList::create(id, title, date, day, last_save_time_stamp, items)
}

pub fn print_todo_list(todo_list: &todolist::TodoList) {
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

pub fn add_todo_item_to_todo_list(
    todo_list: &mut todolist::TodoList,
    todo_item: todoitem::TodoItem,
) {
    todo_list.items.push(todo_item);
}

pub fn get_todo_item(todo_list: &todolist::TodoList, id: i32) -> Option<&todoitem::TodoItem> {
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

pub fn delete_todo_item_from_todo_list(todo_list: &mut todolist::TodoList, id: i32) {
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
            todolist::Day::Monday,
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
}
