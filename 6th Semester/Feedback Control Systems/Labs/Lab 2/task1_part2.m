
r = 120;
w = 0:0.5:5;
ycl = (100*r)/101 - (5*w)/101;

figure;
plot(w, ycl);
xlabel('Disturbance w');
ylabel('Output speed y');
title('Closed Loop Output Speed');
grid on;

% Error
e_cl = abs(r - ycl);
a=

% Percentage error
pe_cl = (e_cl / r) * 100;

% Display values
disp('Closed Loop Output y = ');
disp(ycl);

disp('Closed Loop Error e = ');
disp(e_cl);

disp('Closed Loop Percentage Error = ');
disp(pe_cl);
