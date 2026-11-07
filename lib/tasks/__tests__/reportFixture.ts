/**
 * A made-up report in the same layout as a real 7Clean "Debrief Report" (words of a table row separated by spaces,
 * the page header and table heading repeated on every page, one comment split by a page break). The wording is
 * shortened and there is nothing from a real store in it.
 */
const PAGE_BREAK = `
CONFIDENTIAL AND PROPRIETARY INFORMATION
Report Generated: 10/13/2026 02:27:59 PM Page 2 of 11
CONFIDENTIAL AND PROPRIETARY INFORMATION
Report Generated: 10/13/2026 02:27:59 PM Page 2 of 11

-- 2 of 11 --

Actionable standards
Food Safety
Touchpoint Standard ID Question Category Criticality
Points
Earned
Points
Possible
`;

export const REPORT = `
7Clean
10/13/2026 09:39:00 AM
Location information
Location ID 11111
Property Name 11111: Springfield, NJ
Location -
Brand 7-Eleven Brand
Evaluation information
Visit Type Initial
Start Date Time 10/13/2026 08:37:52 AM
Cycle 4
Visit 1
Overall status, score, and composition
80.00
%
Report category summary
Category/Subcategory Points earned
Total points
possible
Score
General 0 0 0.00%
Food Safety 300 400 75.00%
Proprietary Fresh Food 100 100 100.00%
Vault 50 70 71.43%
Back of House 0 0 0.00%
Total 450 570 80.00%
CONFIDENTIAL AND PROPRIETARY INFORMATION
Report Generated: 10/13/2026 02:27:59 PM Page 1 of 11

Repeat findings
Standard ID Question
Current
response
Previous
inspection
details
PA1 Vault doors fully stocked - four or more empty rows
No Minor No Minor 07/21/20
26
Cycle: 3
Visit: 1
Total count 1
Actionable standards
Food Safety
Touchpoint Standard ID Question Category Criticality
Points
Earned
Points
Possible
Food
Safety
FS5
TCS foods held in cold holding at 40F or lower with a
working thermometer.
Food
Safety
Major 0 20
Response:
No
Comment:
Open air case does not appear to have a thermometer.
Findings:
• Thermometer is not present or not working
Food
Safety
FS1
In-use condiment containers have dates applied.
Food
Safety
Critical 0 50
Response:
No
Comment:
${PAGE_BREAK}Label printer is broken and nobody wrote dates by hand.
Findings:
• Condiment containers not individually dated
Product
Availablit
y
PA1
Vault doors fully stocked - four or more empty rows
Product
Availablity Minor 0 3
Response:
No
Comment:
Five rails observed empty.
Findings:
• 5-8 empty slots in a single vault door
Exterior
Cleanlines
s
EC9
Trash cans emptied and lids closed
Exterior
Cleanliness Major 0 20
Response:
No
Findings:
• Overflowing can by the door
Proprietary Fresh
Touchpoint Standard ID Question Category Criticality
Points
Earned
Points
Possible
Proprietar
y Fresh
PF5
Roller grill products held at 140F or higher and code dated
Proprietary
Fresh Food Critical 50 50
Response:
Yes
Detailed standards
General Information
StandardId Question Category Points
awarded
Points
possible
MANG_FI
RST
Manager First Name General 0 0
Answer:
Pat
MODEma
il
Manager Email General 0 0
Answer:
pat.example@example.com
Store Type
StandardId Question Category Points
awarded
Points
possible
Fuel
Pumps
Does this store have fuel pumps? General 0 0
Answer:
No
Food Safety
StandardId Question Category Points
awarded
Points
possible
AF1 No sanitizer present and in use for cleaning. Auto Fail 0 0
Answer:
No
FS24 Temperature logs fully filled out for hot and cold holding
Food
Safety
0 0
Answer:
No
Findings:
• Temperature log not available.
FS25 Delivery temperatures are documented
Food
Safety
0 0
Answer:
N/A
Product Availablity
StandardId Question Category Points
awarded
Points
possible
PA2 Hot food case stocked with 4 or more unique items
Product
Availablity
0 0
Answer:
No
Findings:
• Only 3 unique items available
PA2a Hot food case stocked with Pizza Product
Availablity
0 0
Answer:
Number of Pizza's Stocked
Findings:
• 0 Slices
Photo
StandardId Question Category Points
awarded
Points
possible
Photo_10
0
Did the store earn 100%? General 0 0
Answer:
No
POSITIVE FEEDBACK
Manager name Manager signature date
Pat Example 10/13/2026 02:24:32 PM
`;

