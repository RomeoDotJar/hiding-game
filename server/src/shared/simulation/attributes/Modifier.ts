export enum ApplyMethod {
    ADDITION = 0,
    MULTIPLICATION = 1,
}

export class Modifier {
  public value: number = 1;
  public applyMethod: ApplyMethod = ApplyMethod.ADDITION;

  constructor(value?: number, applyMethod?: ApplyMethod) {
    this.value = value ?? this.value;
    this.applyMethod = applyMethod ?? this.applyMethod;
  }

  public apply(initial: number) {
    switch (this.applyMethod) {
        case ApplyMethod.ADDITION:
            return initial+this.value;
        case ApplyMethod.MULTIPLICATION:
            return initial*this.value;
        default:
            return initial;
    }
  }
}