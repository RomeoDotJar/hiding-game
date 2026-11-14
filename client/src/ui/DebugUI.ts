export class DebugUI {
  private container: HTMLDivElement;
  private fields: Map<string, HTMLSpanElement> = new Map();

  constructor() {
    // 1. Create the main container
    this.container = document.createElement("div");

    // 2. Add some CSS directly in JS so you don't have to touch index.html
    Object.assign(this.container.style, {
      position: "fixed",
      top: "10px",
      left: "10px",
      padding: "8px 12px",
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      color: "#00FF00", // Classic terminal green
      fontFamily: "monospace",
      fontSize: "12px",
      borderRadius: "4px",
      pointerEvents: "none", // Prevents the UI from blocking mouse clicks on the game
      zIndex: "1000",
      lineHeight: "1.5",
      whiteSpace: "pre", // Keeps formatting clean
    });

    document.body.appendChild(this.container);
  }

  /**
   * Add a new field to the debug UI
   */
  public addField(key: string, initialValue: string | number = "") {
    // Create a row for the field
    const row = document.createElement("div");

    // Create the label (e.g., "FPS: ")
    const label = document.createElement("span");
    label.textContent = `${key}: `;
    label.style.color = "#FFFFFF"; // White label

    // Create the value element that will update
    const value = document.createElement("span");
    value.textContent = String(initialValue);

    row.appendChild(label);
    row.appendChild(value);
    this.container.appendChild(row);

    if (value.textContent.length <= 0) {
      row.style.display = "none";
    } else {
      row.style.display = "block";
    }

    // Store the value element so we can update it later
    this.fields.set(key, value);
  }

  /**
   * Update the value of an existing field
   */
  public updateField(key: string, value: string | number) {
    const element = this.fields.get(key);
    if (element && element.parentElement) {
      element.textContent = String(value);

      if (element.textContent.length <= 0) {
        element.parentElement.style.display = "none";
      } else {
        element.parentElement.style.display = "block";
      }
    }
  }
}
