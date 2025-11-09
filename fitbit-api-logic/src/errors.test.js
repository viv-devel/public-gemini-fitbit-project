import {
    CustomError,
    AuthenticationError,
    ValidationError,
    NotFoundError,
    FitbitApiError,
    MethodNotAllowedError
} from './errors';

describe('CustomError', () => {
    test('should create an instance with a message and default status code', () => {
        const error = new CustomError('Test message');
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Test message');
        expect(error.statusCode).toBe(500);
        expect(error.name).toBe('CustomError');
        expect(error.stack).toBeDefined();
    });

    test('should create an instance with a message and custom status code', () => {
        const error = new CustomError('Another message', 404);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Another message');
        expect(error.statusCode).toBe(404);
        expect(error.name).toBe('CustomError');
        expect(error.stack).toBeDefined();
    });
});

describe('AuthenticationError', () => {
    test('should create an instance with default message and status code', () => {
        const error = new AuthenticationError();
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Authentication failed');
        expect(error.statusCode).toBe(401);
        expect(error.name).toBe('AuthenticationError');
    });

    test('should create an instance with a custom message and status code', () => {
        const error = new AuthenticationError('Auth required', 403);
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Auth required');
        expect(error.statusCode).toBe(403);
        expect(error.name).toBe('AuthenticationError');
    });
});

describe('ValidationError', () => {
    test('should create an instance with default message and status code', () => {
        const error = new ValidationError();
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Validation failed');
        expect(error.statusCode).toBe(400);
        expect(error.name).toBe('ValidationError');
    });

    test('should create an instance with a custom message and status code', () => {
        const error = new ValidationError('Invalid input', 422);
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Invalid input');
        expect(error.statusCode).toBe(422);
        expect(error.name).toBe('ValidationError');
    });
});

describe('NotFoundError', () => {
    test('should create an instance with default message and status code', () => {
        const error = new NotFoundError();
        expect(error).toBeInstanceOf(NotFoundError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Resource not found');
        expect(error.statusCode).toBe(404);
        expect(error.name).toBe('NotFoundError');
    });

    test('should create an instance with a custom message and status code', () => {
        const error = new NotFoundError('User not found', 404);
        expect(error).toBeInstanceOf(NotFoundError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('User not found');
        expect(error.statusCode).toBe(404);
        expect(error.name).toBe('NotFoundError');
    });
});

describe('FitbitApiError', () => {
    test('should create an instance with default message and status code', () => {
        const error = new FitbitApiError();
        expect(error).toBeInstanceOf(FitbitApiError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Fitbit API error');
        expect(error.statusCode).toBe(500);
        expect(error.name).toBe('FitbitApiError');
    });

    test('should create an instance with a custom message and status code', () => {
        const error = new FitbitApiError('Fitbit service unavailable', 503);
        expect(error).toBeInstanceOf(FitbitApiError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Fitbit service unavailable');
        expect(error.statusCode).toBe(503);
        expect(error.name).toBe('FitbitApiError');
    });
});

describe('MethodNotAllowedError', () => {
    test('should create an instance with default message and status code', () => {
        const error = new MethodNotAllowedError();
        expect(error).toBeInstanceOf(MethodNotAllowedError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Method Not Allowed');
        expect(error.statusCode).toBe(405);
        expect(error.name).toBe('MethodNotAllowedError');
    });

    test('should create an instance with a custom message and status code', () => {
        const error = new MethodNotAllowedError('POST not allowed', 405);
        expect(error).toBeInstanceOf(MethodNotAllowedError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('POST not allowed');
        expect(error.statusCode).toBe(405);
        expect(error.name).toBe('MethodNotAllowedError');
    });
});
