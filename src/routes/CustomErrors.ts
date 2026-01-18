export class AuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends Error {
  code: string;
  status: number;
  field?: string;

  constructor(code: string, message: string, field?: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

export class NotFoundError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 404) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class PermissionError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
