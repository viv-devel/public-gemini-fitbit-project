import {
    CustomError,
    AuthenticationError,
    ValidationError,
    NotFoundError,
    FitbitApiError,
    MethodNotAllowedError
} from './errors.js';

describe('CustomError', () => {
    test('should create a custom error with default status code 500', () => {
        const error = new CustomError('Test Custom Error');
        expect(error).toBeInstanceOf(CustomError);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Test Custom Error');
        expect(error.statusCode).toBe(500);
        expect(error.name).toBe('CustomError');
    });

    test('should create a custom error with a specified status code', () => {
        const error = new CustomError('Test Custom Error', 404);
        expect(error.statusCode).toBe(404);
    });
});

describe('AuthenticationError', () => {
    test('should create an authentication error with default message and status code 401', () => {
        const error = new AuthenticationError();
        expect(error).toBeInstanceOf(AuthenticationError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Authentication failed');
        expect(error.statusCode).toBe(401);
        expect(error.name).toBe('AuthenticationError');
    });

    test('should create an authentication error with a custom message', () => {
        const error = new AuthenticationError('Custom Auth Error');
        expect(error.message).toBe('Custom Auth Error');
    });
});

describe('ValidationError', () => {
    test('should create a validation error with default message and status code 400', () => {
        const error = new ValidationError();
        expect(error).toBeInstanceOf(ValidationError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Validation failed');
        expect(error.statusCode).toBe(400);
        expect(error.name).toBe('ValidationError');
    });

    test('should create a validation error with a custom message', () => {
        const error = new ValidationError('Custom Validation Error');
        expect(error.message).toBe('Custom Validation Error');
    });
});

describe('NotFoundError', () => {
    test('should create a not found error with default message and status code 404', () => {
        const error = new NotFoundError();
        expect(error).toBeInstanceOf(NotFoundError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Resource not found');
        expect(error.statusCode).toBe(404);
        expect(error.name).toBe('NotFoundError');
    });

    test('should create a not found error with a custom message', () => {
        const error = new NotFoundError('Custom Not Found Error');
        expect(error.message).toBe('Custom Not Found Error');
    });
});

describe('FitbitApiError', () => {
    test('should create a Fitbit API error with default message and status code 500', () => {
        const error = new FitbitApiError();
        expect(error).toBeInstanceOf(FitbitApiError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Fitbit API error');
        expect(error.statusCode).toBe(500);
        expect(error.name).toBe('FitbitApiError');
    });

    test('should create a Fitbit API error with a custom message', () => {
        const error = new FitbitApiError('Custom Fitbit API Error');
        expect(error.message).toBe('Custom Fitbit API Error');
    });
});

describe('MethodNotAllowedError', () => {
    test('should create a method not allowed error with default message and status code 405', () => {
        const error = new MethodNotAllowedError();
        expect(error).toBeInstanceOf(MethodNotAllowedError);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.message).toBe('Method Not Allowed');
        expect(error.statusCode).toBe(405);
        expect(error.name).toBe('MethodNotAllowedError');
    });

    test('should create a method not allowed error with a custom message', () => {
        const error = new MethodNotAllowedError('Custom Method Not Allowed Error');
        expect(error.message).toBe('Custom Method Not Allowed Error');
    });
});
