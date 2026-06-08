clc;
clear;
close all;

% -----------------------------
% Signal and index
% -----------------------------
x = [1 2 3 4 5 6 7 6 5 4 3 2 1];
n = -6:6;          % must match x length

% -----------------------------
% Time indices
% -----------------------------
n2 = n;            % x[n]
n3 = n + 2;        % x[n-2]

x2 = x;
x3 = x;

% -----------------------------
% Signal multiplication
% -----------------------------
n_start = max(min(n2), min(n3));
n_end   = min(max(n2), max(n3));
n_out = n_start:n_end;

y = zeros(1,length(n_out));

for i = 1:length(n_out)

    % x[n]
    idx2 = find(n2 == n_out(i));
    if ~isempty(idx2)
        v2 = x2(idx2);
    else
        v2 = 0;
    end

    % x[n-2]
    idx3 = find(n3 == n_out(i));
    if ~isempty(idx3)
        v3 = x3(idx3);
    else
        v3 = 0;
    end

    y(i) = v2 * v3;
end

% -----------------------------
% Plot
% -----------------------------
stem(n_out, y, 'filled', 'LineWidth', 2)
grid on
xlabel('n','FontWeight','bold')
ylabel('x[n]','FontWeight','bold')
