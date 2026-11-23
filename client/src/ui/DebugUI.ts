import { isMobile } from "pixi.js";

export class DebugUI {
  private container: HTMLDivElement;
  private fields: Map<string, HTMLSpanElement> = new Map();
  private inputs: Map<string, HTMLInputElement> = new Map();

  constructor() {
    // 1. Create the main container
    this.container = document.createElement("div");

    // 2. Add some CSS directly in JS so you don't have to touch index.html
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '10px',
      left: '10px',
      padding: '8px 12px',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      color: '#00FF00',
      fontFamily: 'monospace',
      fontSize: isMobile.any ? '8px' : '12px',
      borderRadius: '4px',
      pointerEvents: 'none', // Keep the main container click-through
      zIndex: '1000',
      lineHeight: isMobile.any ? '1' : '1.5',
      whiteSpace: 'pre',
      display: 'flex',
      flexDirection: 'column',
      gap: isMobile.any ? '2px' : '4px'
    });

    document.body.appendChild(this.container);
  }

  /**
   * Add a new field to the debug UI
   */
  public addField(key: string, initialValue: string | number = "") {
    const row = document.createElement("div");

    const label = document.createElement("span");
    label.textContent = `${key}: `;
    label.style.color = "#FFFFFF"; // White label

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

    this.fields.set(key, value);
  }

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

  /**
   * Add an input field to the UI. 
   * @param key The label for the input.
   * @param initialValue The starting value.
   * @param onChange Callback fired when the user changes the value.
   */
  public addInputField(
    key: string, 
    initialValue: string | number, 
    onChange: (value: string) => void
  ): HTMLInputElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      pointerEvents: 'auto', // Re-enable clicks for this row
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px'
    });

    const label = document.createElement('span');
    label.textContent = `${key}: `;
    label.style.color = '#FFFFFF';

    const input = document.createElement('input');
    input.type = 'number'; // Default to number, can be changed later if needed
    input.value = String(initialValue);
    
    Object.assign(input.style, {
      width: '60px',
      backgroundColor: '#222',
      color: '#00FF00',
      border: '1px solid #555',
      fontFamily: 'monospace',
      fontSize: '12px',
      padding: '2px 4px',
      outline: 'none'
    });

    // Listen for changes (fires when the user presses Enter or clicks away)
    input.addEventListener('change', (e) => {
      onChange((e.target as HTMLInputElement).value);
    });

    // Also listen for 'Enter' key to blur the input and trigger change
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });

    row.appendChild(label);
    row.appendChild(input);
    this.container.appendChild(row);

    this.inputs.set(key, input);
    return input;
  }

  /**
   * Get the current value of an input field.
   */
  public getInputValue(key: string): string | undefined {
    return this.inputs.get(key)?.value;
  }

  /**
   * Toggle the UI's visibility
   */
  public setVisible(visible: boolean) {
    this.container.style.display = visible ? "flex" : "none";
  }

  /**
   * Returns the UI's visibility
   */
  public isVisible = () => this.container.style.display !== 'none';
}
