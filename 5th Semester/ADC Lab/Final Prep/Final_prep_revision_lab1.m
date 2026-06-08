clc; close all; clear all
% clc       → Clears the command window
% close all → Closes all open figure windows
% clear all → Clears all variables from workspace
% These three ensure you start with a clean environment


%% --- Signal Definition Section ---
Fs = 192;        % Sampling frequency (192 samples per second)
f = 8;           % Frequency of the first cosine signal (8 Hz)
N = 96;          % Total number of samples (we will take 96 samples)
n = 0:N-1;       % Sample index vector: 0, 1, 2, ..., 95

T = 1/Fs;        % Sampling period (time between two samples)
% T = 1/192 ≈ 0.005208 seconds

t = n*T;         % Time vector for each sample (t = n/Fs)
% This gives time values from 0 to (N-1)/Fs = 0.5 seconds total duration


%% --- Signal Generation ---
m = cos(2*pi*8*t);     % First cosine wave: frequency = 8 Hz, amplitude = 1
c = cos(2*pi*12*t);    % Second cosine wave: frequency = 12 Hz, amplitude = 1

y = m + c;              % Sum of the two cosine signals
% The resulting signal y(t) contains frequency components at 8 Hz and 12 Hz


%% --- Frequency Domain Analysis (FFT Section) ---
Xk = fft(y)/N;          % Compute Fast Fourier Transform and normalize by N
% fft(y) computes the discrete Fourier transform of y
% Division by N normalizes the amplitude (since MATLAB's fft output is scaled by N)
% Without dividing, your amplitude would be N times larger than actual

Y = abs(Xk);            % Magnitude of FFT (convert complex numbers to absolute values)
% Since FFT gives complex values, abs() gives amplitude of each frequency

X = fftshift(Y);        % Shift zero frequency component to the center
% By default, MATLAB's fft output has 0 Hz at the beginning
% fftshift() rearranges the data so that negative frequencies are on the left
% and positive frequencies are on the right — giving a centered spectrum


%% --- Frequency Axis Creation ---
fx = -Fs/2 : Fs/length(X) : Fs/2 - (Fs/length(X));
% Creates the frequency vector (x-axis for FFT plot)
% Range: -Fs/2 to +Fs/2  → from -96 Hz to +96 Hz
% Step size = Fs/length(X), ensures one frequency value per FFT point


%% --- Plotting the Results ---
subplot(211)                 % Divide window into 2 rows, 1 column → activate top plot
plot(t, y, 'linewidth', 2);  % Plot time-domain signal
xlabel('t (seconds)')        % Label x-axis as time
ylabel('y(t)')               % Label y-axis as signal amplitude
title('Original Signal y(t)')% Title of first plot
grid on                      % Show grid for better readability

subplot(212)                 % Activate bottom subplot (2nd plot)
stem(fx, X, 'filled', 'linewidth', 2); % Plot magnitude spectrum using stem (discrete plot)
xlabel('Frequency (Hz)  [-Fs/2 to Fs/2]', 'fontweight', 'bold');
ylabel('|X(k)|  (Magnitude)', 'fontweight', 'bold');
title('Frequency Domain Spectrum of y(t)');
grid on                      % Add grid for clarity

% --- INTERPRETATION ---
% The top plot shows the signal y(t) in the time domain (sum of 8 Hz and 12 Hz waves)
% The bottom plot shows the frequency spectrum (FFT)
% You should see two spikes (peaks) in the spectrum at ±8 Hz and ±12 Hz
% These peaks represent the two cosine frequencies present in the signal
