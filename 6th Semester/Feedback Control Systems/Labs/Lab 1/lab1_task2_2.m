%task 2 part 1
num=[2 1]
den=[10 3 2]

zeros=roots(num)
poles=roots(den)
k = num(1)/den(1)

g=zpk(zeros,poles,k)
display(g)
%task 2 part 2

num = [1 0 0 -1]
den=[4 0 0 3 2]
zeros=roots(num)
poles=roots(den)
k=num(1)/den(1)

g2=zpk(zeros,poles,k)
display(g2)
