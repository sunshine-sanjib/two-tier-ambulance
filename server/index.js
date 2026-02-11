const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// REPLACE THIS with your actual Google Maps API Key
const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY';

app.get('/', (req, res) => {
    res.send('Ambulance Dispatch Server Running');
});

/**
 * Endpoint to calculate the optimal intercept point
 * Body: { patientLoc: {lat, lng}, alsLoc: {lat, lng}, hospitalLoc: {lat, lng} }
 */
app.post('/calculate-intercept', async (req, res) => {
    try {
        const { patientLoc, alsLoc, hospitalLoc } = req.body;

        if (!patientLoc || !alsLoc || !hospitalLoc) {
            return res.status(400).json({ error: "Missing coordinates" });
        }

        // STEP 1: Get the route from Patient to Hospital (the path the BLS ambulance will take)
        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${patientLoc.lat},${patientLoc.lng}&destination=${hospitalLoc.lat},${hospitalLoc.lng}&key=${GOOGLE_MAPS_API_KEY}`;

        const directionsRes = await axios.get(directionsUrl);
        const steps = directionsRes.data.routes[0].legs[0].steps;

        // STEP 2: Pick candidate points along the route
        // We take the end_location of each step as a potential meeting spot
        const candidatePoints = steps.map(step => ({
            lat: step.end_location.lat,
            lng: step.end_location.lng
        }));

        // STEP 3: Use Distance Matrix to find ETAs to all candidate points for BOTH ambulances
        const destinations = candidatePoints.map(p => `${p.lat},${p.lng}`).join('|');
        const matrixUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${patientLoc.lat},${patientLoc.lng}|${alsLoc.lat},${alsLoc.lng}&destinations=${destinations}&key=${GOOGLE_MAPS_API_KEY}`;

        const matrixRes = await axios.get(matrixUrl);
        const blsTimes = matrixRes.data.rows[0].elements; // ETAs from Patient Start
        const alsTimes = matrixRes.data.rows[1].elements; // ETAs from ALS Current Pos

        // STEP 4: Logic - Find the point where |Time_BLS - Time_ALS| is minimized
        let bestPoint = null;
        let minimumDifference = Infinity;
        let finalEta = 0;

        for (let i = 0; i < candidatePoints.length; i++) {
            const t1 = blsTimes[i].duration.value; // in seconds
            const t2 = alsTimes[i].duration.value; // in seconds

            const difference = Math.abs(t1 - t2);

            // We want the point where they arrive at roughly the same time
            if (difference < minimumDifference) {
                minimumDifference = difference;
                bestPoint = candidatePoints[i];
                finalEta = Math.max(t1, t2); // The actual time they will meet
            }
        }

        // STEP 5: Return the result to the mobile app
        res.json({
            success: true,
            midpoint: bestPoint,
            etaSeconds: finalEta,
            timeDifference: minimumDifference,
            routeToHospital: directionsRes.data.routes[0].overview_polyline.points
        });

    } catch (error) {
        console.error("Error calculating intercept:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`--- Ambulance Server ---`);
    console.log(`Running on http://localhost:${PORT}`);
    console.log(`Ready to calculate intercept points.`);
});