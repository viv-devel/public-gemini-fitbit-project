export class CustomError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class AuthenticationError extends CustomError {
    constructor(message = 'Authentication failed', statusCode = 401) {
        super(message, statusCode);
    }
}

export class ValidationError extends CustomError {
    constructor(message = 'Validation failed', statusCode = 400) {
        super(message, statusCode);
    }
}

export class NotFoundError extends CustomError {
    constructor(message = 'Resource not found', statusCode = 404) {
        super(message, statusCode);
    }
}

export class FitbitApiError extends CustomError {
    constructor(message = 'Fitbit API error', statusCode = 500) {
        super(message, statusCode);
    }
}

export class MethodNotAllowedError extends CustomError {
    constructor(message = 'Method Not Allowed', statusCode = 405) {
        super(message, statusCode);
    }
}
